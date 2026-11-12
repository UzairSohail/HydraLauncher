//! Google sign-in from another device, for handhelds and TVs where using a
//! browser and keyboard is awkward (for example SteamOS game mode).
//!
//! Nacho Launcher shows a short code and a QR code for Google's
//! "TVs and Limited Input devices" flow. The user opens the page on their
//! phone, enters the code and allows access, while this device polls Google
//! until the sign-in finishes. The scope is the same `drive.file` as the
//! browser sign-in, so the user's Drive files are the same.
//!
//! A refresh token only works with the client that issued it, so after this
//! sign-in the device client is written to the shared state folder's
//! `client.json` (which Cloud Save Manager already prefers over its built-in
//! client), marked so that a later browser sign-in knows to replace it.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use cloud_save_manager::google::{self, Client, SCOPE};
use cloud_save_manager::secrets;
use serde_json::{json, Value};

const DEVICE_CODE_URL: &str = "https://oauth2.googleapis.com/device/code";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
/// Set in `client.json` when this module wrote it.
const MARKER: &str = "nacho_device_client";

/// Added at build time from GitHub secrets, like the browser client.
pub fn device_client() -> Option<Client> {
    let client_id = option_env!("NACHO_GOOGLE_DEVICE_CLIENT_ID")?;
    let client_secret = option_env!("NACHO_GOOGLE_DEVICE_CLIENT_SECRET")?;
    if client_id.is_empty() || client_secret.is_empty() {
        return None;
    }
    Some(Client { client_id: client_id.to_string(), client_secret: client_secret.to_string() })
}

/// True when `client.json` holds the device client this module wrote.
pub fn is_device_client_file(path: &Path) -> bool {
    std::fs::read(path)
        .ok()
        .and_then(|data| serde_json::from_slice::<Value>(&data).ok())
        .is_some_and(|file| file[MARKER].as_bool() == Some(true))
}

fn write_device_client_file(path: &Path, client: &Client) -> Result<()> {
    let file = json!({
        "installed": { "client_id": client.client_id, "client_secret": client.client_secret },
        MARKER: true,
    });
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.new");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&file)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// What the user needs to finish signing in on their phone.
pub struct DeviceCode {
    pub user_code: String,
    pub verification_url: String,
    pub expires_in_seconds: u32,
    /// The verification page as a QR code, as an SVG document.
    pub qr_svg: String,
}

struct Pending {
    handle: JoinHandle<Result<()>>,
    cancelled: Arc<AtomicBool>,
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);

/// What a form post to Google answered: the JSON reply, or the OAuth error code.
fn post(agent: &ureq::Agent, url: &str, form: &[(&str, &str)]) -> Result<std::result::Result<Value, String>> {
    match agent.post(url).send_form(form) {
        Ok(reply) => Ok(Ok(reply.into_json()?)),
        Err(ureq::Error::Status(code, reply)) => {
            let body: Value = reply.into_json().unwrap_or(Value::Null);
            let error = body["error"].as_str().map(str::to_string).unwrap_or_else(|| format!("http_{code}"));
            Ok(Err(error))
        }
        Err(e) => Err(anyhow!("couldn't reach Google: {e}")),
    }
}

fn qr_svg(text: &str) -> Result<String> {
    let code = qrcode::QrCode::new(text.as_bytes()).context("couldn't make the QR code")?;
    Ok(code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .build())
}

fn cancel_pending() {
    if let Ok(mut slot) = PENDING.lock() {
        if let Some(pending) = slot.take() {
            pending.cancelled.store(true, Ordering::SeqCst);
        }
    }
}

/// Waits `seconds`, returning early (with false) when cancelled.
fn wait(cancelled: &AtomicBool, seconds: u64) -> bool {
    let until = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < until {
        if cancelled.load(Ordering::SeqCst) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    !cancelled.load(Ordering::SeqCst)
}

/// Asks Google for a code and starts waiting for the user to approve it.
/// `state_dir` and `client_path` are the shared Cloud Save Manager paths.
pub fn begin(state_dir: &Path, client_path: &Path) -> Result<DeviceCode> {
    let client = device_client().context("this build doesn't include phone sign-in")?;
    cancel_pending();

    let agent = google::agent();
    let reply = post(&agent, DEVICE_CODE_URL, &[("client_id", &client.client_id), ("scope", SCOPE)])?
        .map_err(|error| anyhow!("Google refused to start sign-in: {error}"))?;
    let device_code = reply["device_code"].as_str().context("Google didn't return a device code")?.to_string();
    let user_code = reply["user_code"].as_str().context("Google didn't return a code")?.to_string();
    let verification_url = reply["verification_url"]
        .as_str()
        .or_else(|| reply["verification_uri"].as_str())
        .unwrap_or("https://www.google.com/device")
        .to_string();
    let expires_in = reply["expires_in"].as_u64().unwrap_or(1800);
    let mut interval = reply["interval"].as_u64().unwrap_or(5).max(1);

    let cancelled = Arc::new(AtomicBool::new(false));
    let thread_cancelled = cancelled.clone();
    let state_dir = state_dir.to_path_buf();
    let client_path = client_path.to_path_buf();
    let handle = std::thread::spawn(move || -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(expires_in);
        loop {
            if !wait(&thread_cancelled, interval) {
                bail!("sign-in was cancelled");
            }
            if Instant::now() >= deadline {
                bail!("the code expired before sign-in finished");
            }
            let answer = match post(&agent, TOKEN_URL, &[
                ("client_id", &client.client_id),
                ("client_secret", &client.client_secret),
                ("device_code", &device_code),
                ("grant_type", DEVICE_GRANT),
            ]) {
                Ok(answer) => answer,
                // A dropped connection shouldn't end the sign-in; try again.
                Err(_) => continue,
            };
            match answer {
                Ok(reply) => {
                    let token = reply["refresh_token"]
                        .as_str()
                        .context("Google didn't return a refresh token")?;
                    if thread_cancelled.load(Ordering::SeqCst) {
                        bail!("sign-in was cancelled");
                    }
                    // Client first: the token alone is useless without it.
                    write_device_client_file(&client_path, &client)?;
                    return secrets::save(&state_dir, token);
                }
                Err(error) => match error.as_str() {
                    "authorization_pending" => {}
                    "slow_down" => interval += 5,
                    "access_denied" => bail!("sign-in was declined on the phone"),
                    "expired_token" => bail!("the code expired before sign-in finished"),
                    other => bail!("Google refused sign-in: {other}"),
                },
            }
        }
    });

    *PENDING.lock().map_err(|_| anyhow!("sign-in state is unavailable"))? = Some(Pending { handle, cancelled });

    Ok(DeviceCode {
        qr_svg: qr_svg(&verification_url)?,
        user_code,
        verification_url,
        expires_in_seconds: expires_in.min(u32::MAX as u64) as u32,
    })
}

/// Waits until the user approves on their phone, declines, or the code expires.
pub fn finish() -> Result<()> {
    let pending = PENDING
        .lock()
        .map_err(|_| anyhow!("sign-in state is unavailable"))?
        .take()
        .context("sign-in hasn't started")?;
    pending.handle.join().map_err(|_| anyhow!("sign-in stopped unexpectedly"))?
}

pub fn cancel() {
    cancel_pending();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_client_file_is_marked_and_still_a_desktop_client_file() {
        let dir = std::env::temp_dir().join(format!("nacho-device-{}", std::process::id()));
        let path = dir.join("client.json");
        let client = Client { client_id: "id".into(), client_secret: "secret".into() };
        write_device_client_file(&path, &client).unwrap();
        assert!(is_device_client_file(&path));
        let loaded = Client::load(&path).unwrap();
        assert_eq!(loaded.client_id, "id");
        assert_eq!(loaded.client_secret, "secret");
        std::fs::write(&path, br#"{"installed":{"client_id":"a","client_secret":"b"}}"#).unwrap();
        assert!(!is_device_client_file(&path));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn qr_code_is_an_svg() {
        assert!(qr_svg("https://www.google.com/device").unwrap().contains("<svg"));
    }
}
