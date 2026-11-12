//! Cloud saves through Cloud Save Manager, the user's own Google Drive sync.
//!
//! Hydra opens the same state folder as the Cloud Save Manager app, so both share
//! this device's Google sign-in, game catalogue, sync base and playing markers.
//! Everything here blocks on network or disk, so it runs on a blocking thread.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use cloud_save_manager::app::{device_name, endpoints, App};
use cloud_save_manager::background::{Playing, UploadGuard};
use cloud_save_manager::catalogue::{Catalogue, Game};
use cloud_save_manager::detect::{self, Learned};
use cloud_save_manager::device::Device;
use cloud_save_manager::engine::{Engine, Keep, Outcome};
use cloud_save_manager::google::{self, Client};
use cloud_save_manager::manage::{self, SyncStatus};
use cloud_save_manager::secrets;
use cloud_save_manager::state::State;
use cloud_save_manager::store::{Store, Version};
use cloud_save_manager::wrap::{self, Log};
use napi::bindgen_prelude::{Buffer, Error};

use crate::google_device;
use napi_derive::napi;

/// Hydra's own files in the Drive folder live under this key.
const HYDRA_PREFIX: &str = "hydra/";

/// Exe names that many unrelated games share, so a name match alone isn't enough.
const GENERIC_EXES: &[&str] = &[
    "game", "launcher", "start", "play", "main", "app", "run", "client", "setup", "unitycrashhandler64",
];

fn to_napi(error: anyhow::Error) -> Error {
    Error::from_reason(format!("{error:#}"))
}

async fn blocking<T, F>(work: F) -> napi::Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| Error::from_reason(format!("cloud save task stopped: {e}")))?
        .map_err(to_napi)
}

fn open_app() -> Result<App> {
    App::open(std::env::var_os("CSM_STATE_DIR").map(PathBuf::from), None, std::env::var_os("CSM_REMOTE_DIR").map(PathBuf::from))
}

struct Opened {
    app: App,
    store: Store,
    state: State,
}

impl Opened {
    fn new() -> Result<Self> {
        let app = open_app()?;
        let store = Store::with_blobs(app.remote()?);
        let state = State::open(&app.state_path())?;
        Ok(Self { app, store, state })
    }

    fn engine(&self) -> Engine<'_> {
        Engine { store: &self.store, state: &self.state, device: device_name(), safety_root: self.app.safety_root() }
    }

    fn catalogue(&self) -> Result<Catalogue> {
        self.app.shared_catalogue(&self.store)
    }

    fn device(&self) -> Result<Device> {
        Device::load(&self.app.device_path)
    }

    fn game(&self, id: &str) -> Result<Game> {
        Ok(self.catalogue()?.game(id)?.clone())
    }

    fn log(&self) -> Option<Log> {
        Log::open(&self.app.log_dir()).ok()
    }
}

fn log_line(log: &Option<Log>, text: &str) {
    if let Some(log) = log {
        log.line(&format!("hydra: {text}"));
    }
}

// Status and sign-in

#[napi(object)]
pub struct PersonalCloudStatus {
    pub signed_in: bool,
    pub paused: bool,
    pub state_dir: String,
    /// This build can sign in from a phone (see google_device.rs).
    pub phone_sign_in_available: bool,
}

#[napi]
pub async fn personal_cloud_status() -> napi::Result<PersonalCloudStatus> {
    blocking(|| {
        let app = open_app()?;
        let paused = State::open(&app.state_path()).and_then(|state| manage::is_paused(&state)).unwrap_or(false);
        Ok(PersonalCloudStatus {
            signed_in: app.is_signed_in(),
            paused,
            state_dir: app.state_dir.to_string_lossy().into_owned(),
            phone_sign_in_available: google_device::device_client().is_some(),
        })
    })
    .await
}

static SIGN_IN: Mutex<Option<JoinHandle<Result<()>>>> = Mutex::new(None);

/// Starts Google sign-in and returns the page to open in a browser. Finish with
/// `personalCloudFinishSignIn`, which waits for the browser to come back.
#[napi]
pub async fn personal_cloud_begin_sign_in() -> napi::Result<String> {
    blocking(|| {
        let app = open_app()?;
        let client_path = app.client_path();
        // A phone sign-in leaves the device client in client.json, which can't
        // do a browser sign-in. Use the built-in client and drop that file once
        // the new sign-in is saved.
        let replaces_device_client = google_device::is_device_client_file(&client_path);
        let client = if replaces_device_client {
            Client::built_in().context("this build has no browser sign-in details")?
        } else {
            Client::find(&client_path)?
        };
        let (send, receive) = mpsc::channel::<String>();
        let state_dir = app.state_dir.clone();
        let handle = std::thread::spawn(move || -> Result<()> {
            let token = google::login(&endpoints(), &client, |url| {
                let _ = send.send(url.to_string());
            })?;
            secrets::save(&state_dir, &token)?;
            if replaces_device_client {
                let _ = std::fs::remove_file(&client_path);
            }
            Ok(())
        });
        let url = receive.recv_timeout(Duration::from_secs(10));
        let mut slot = SIGN_IN.lock().map_err(|_| anyhow!("sign-in state is unavailable"))?;
        match url {
            Ok(url) => {
                *slot = Some(handle);
                Ok(url)
            }
            Err(_) => match handle.join() {
                Ok(Err(e)) => Err(e),
                _ => bail!("sign-in didn't start"),
            },
        }
    })
    .await
}

#[napi]
pub async fn personal_cloud_finish_sign_in() -> napi::Result<()> {
    blocking(|| {
        let handle = SIGN_IN
            .lock()
            .map_err(|_| anyhow!("sign-in state is unavailable"))?
            .take()
            .context("sign-in hasn't started")?;
        handle.join().map_err(|_| anyhow!("sign-in stopped unexpectedly"))?
    })
    .await
}

// Phone sign-in (Google's flow for TVs and handhelds)

#[napi(object)]
pub struct PersonalCloudDeviceCode {
    pub user_code: String,
    pub verification_url: String,
    pub expires_in_seconds: u32,
    pub qr_svg: String,
}

/// True when this build can sign in from another device.
#[napi]
pub fn personal_cloud_device_sign_in_available() -> bool {
    google_device::device_client().is_some()
}

/// Gets a code to enter on a phone. Finish with `personalCloudFinishDeviceSignIn`.
#[napi]
pub async fn personal_cloud_begin_device_sign_in() -> napi::Result<PersonalCloudDeviceCode> {
    blocking(|| {
        let app = open_app()?;
        let code = google_device::begin(&app.state_dir, &app.client_path())?;
        Ok(PersonalCloudDeviceCode {
            user_code: code.user_code,
            verification_url: code.verification_url,
            expires_in_seconds: code.expires_in_seconds,
            qr_svg: code.qr_svg,
        })
    })
    .await
}

#[napi]
pub async fn personal_cloud_finish_device_sign_in() -> napi::Result<()> {
    blocking(google_device::finish).await
}

#[napi]
pub fn personal_cloud_cancel_device_sign_in() {
    google_device::cancel();
}

#[napi]
pub async fn personal_cloud_set_paused(paused: bool) -> napi::Result<()> {
    blocking(move || {
        let app = open_app()?;
        manage::set_paused(&State::open(&app.state_path())?, paused)
    })
    .await
}

// Connecting Hydra games to catalogue games

#[napi(object)]
pub struct PersonalCloudLinkInput {
    pub exe_path: String,
    pub name: String,
    /// Hydra's Wine prefix on Linux, the folder holding drive_c.
    pub wine_prefix_path: Option<String>,
}

#[napi(object)]
pub struct PersonalCloudLinkResult {
    pub game_id: String,
    /// False until Cloud Save Manager knows where the game saves.
    pub in_catalogue: bool,
    pub save_location: Option<String>,
}

fn is_generic_exe(exe_name: &str) -> bool {
    let stem = exe_name.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(exe_name);
    GENERIC_EXES.contains(&stem.to_ascii_lowercase().as_str())
}

/// Finds the catalogue game for an exe. A generic exe name also needs the
/// game's name to match, so two unrelated games can't share saves.
fn find_catalogued<'a>(catalogue: &'a Catalogue, exe_name: &str, name: &str) -> Option<&'a Game> {
    let matches_exe = |game: &&Game| game.exe.eq_ignore_ascii_case(exe_name);
    if is_generic_exe(exe_name) {
        let wanted = detect::normalize(&detect::clean_name(name));
        return catalogue.games.iter().filter(matches_exe).find(|game| detect::normalize(&game.name) == wanted);
    }
    catalogue.games.iter().find(matches_exe)
}

fn unique_id(catalogue: &Catalogue, name: &str) -> String {
    let base = detect::slug(name);
    let base = if base.is_empty() { "game".to_string() } else { base };
    let mut id = base.clone();
    let mut n = 2;
    while catalogue.games.iter().any(|game| game.id == id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

/// Records where a Hydra game lives on this device, matching it to the shared
/// catalogue by exe name, or detecting its saves if it's new.
#[napi]
pub async fn personal_cloud_link_game(input: PersonalCloudLinkInput) -> napi::Result<PersonalCloudLinkResult> {
    blocking(move || {
        let opened = Opened::new()?;
        let mut catalogue = opened.catalogue()?;
        let exe = PathBuf::from(&input.exe_path);
        let exe_name = exe.file_name().map(|n| n.to_string_lossy().into_owned()).context("the game has no exe")?;
        let stem = exe.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let name = detect::clean_name(&input.name);
        let existing = find_catalogued(&catalogue, &exe_name, &name).map(|game| game.id.clone());
        let mut device = opened.device()?;
        // A game this device already linked keeps its id, even if it isn't catalogued yet.
        let linked = device
            .links
            .iter()
            .find(|(_, link)| link.exe.as_deref() == Some(exe.as_path()))
            .map(|(id, _)| id.clone());
        let id = existing.clone().or(linked).unwrap_or_else(|| unique_id(&catalogue, &name));
        let link = device.links.entry(id.clone()).or_default();
        link.game_dir = exe.parent().map(Path::to_path_buf);
        link.name = Some(name.clone());
        link.exe = Some(exe.clone());
        if link.compat_data.is_none() {
            link.prefix = input.wine_prefix_path.as_ref().map(PathBuf::from);
        }
        device.save(&opened.app.device_path)?;

        if existing.is_none() && catalogue.game(&id).is_err() {
            let roots = device.roots_for(&id, None);
            if let Some(found) = detect::detect(&exe, &[name.clone(), stem], &roots) {
                log_line(&opened.log(), &format!("{id} saves at {} from {}", found.save.key(), found.how));
                catalogue.upsert(Game { id: id.clone(), name, exe: exe_name, saves: vec![found.save] });
                catalogue.save(&opened.app.catalogue_path)?;
                catalogue = opened.catalogue()?;
            }
        }
        let game = catalogue.game(&id).ok();
        Ok(PersonalCloudLinkResult {
            game_id: id,
            in_catalogue: game.is_some(),
            save_location: game.and_then(|g| g.saves.first()).map(|save| save.key()),
        })
    })
    .await
}

/// Starts syncing a game from a save folder the user picked or Hydra detected.
#[napi]
pub async fn personal_cloud_adopt_game(game_id: String, name: String, folder: String) -> napi::Result<()> {
    blocking(move || {
        let opened = Opened::new()?;
        let device = opened.device()?;
        let link = device.links.get(&game_id).context("link the game first")?;
        let exe = link
            .exe
            .as_deref()
            .and_then(Path::file_name)
            .map(|n| n.to_string_lossy().into_owned())
            .context("the game has no exe")?;
        opened.catalogue()?;
        let roots = device.roots_for(&game_id, None);
        manage::adopt_game(&opened.store, &game_id, &name, &exe, Path::new(&folder), &roots, &opened.app.catalogue_path)
    })
    .await
}

// Syncing

#[napi(object)]
pub struct PersonalCloudSyncResult {
    /// up_to_date, pulled, pushed, offline, waiting_for_prefix, not_in_catalogue or learning.
    pub outcome: String,
    pub version_id: Option<String>,
    pub queued: bool,
    /// Set when a conflict was settled: "local" or "cloud".
    pub kept: Option<String>,
    /// Folders that changed while learning, when it couldn't choose one.
    pub unclear: Vec<String>,
}

impl PersonalCloudSyncResult {
    fn simple(outcome: &str) -> Self {
        Self { outcome: outcome.into(), version_id: None, queued: false, kept: None, unclear: Vec::new() }
    }

    fn from_outcome(outcome: Outcome, keep: Option<Keep>) -> Self {
        let mut result = match outcome {
            Outcome::UpToDate => Self::simple("up_to_date"),
            Outcome::Pulled(id) => Self { version_id: Some(id), ..Self::simple("pulled") },
            Outcome::Pushed(id) => Self { version_id: Some(id), ..Self::simple("pushed") },
            Outcome::Offline { queued } => Self { queued, ..Self::simple("offline") },
            Outcome::WaitingForPrefix => Self::simple("waiting_for_prefix"),
            // sync_settled never returns this, but report it rather than hide it.
            Outcome::Conflict { .. } => Self::simple("conflict"),
        };
        result.kept = keep.map(|keep| if keep == Keep::Local { "local" } else { "cloud" }.to_string());
        result
    }
}

fn sync_game(opened: &Opened, game: &Game, after_play: bool) -> Result<PersonalCloudSyncResult> {
    let device = opened.device()?;
    let roots = device.roots_for(&game.id, None);
    let log = opened.log();
    let _uploading = after_play.then(UploadGuard::start);
    if after_play {
        // Hydra already knows the game exited, so this only waits for saves to settle.
        if let Some(log) = &log {
            wrap::wait_for_game_to_finish(game, &roots, None, log);
        }
    }
    let (outcome, keep) = opened.engine().sync_settled(game, &roots)?;
    log_line(&log, &format!("{} {outcome:?} {keep:?}", game.id));
    Ok(PersonalCloudSyncResult::from_outcome(outcome, keep))
}

/// Syncs one game. Use `afterPlay` once the game has exited, so it waits for
/// saves to stop changing first.
#[napi]
pub async fn personal_cloud_sync(game_id: String, after_play: bool) -> napi::Result<PersonalCloudSyncResult> {
    blocking(move || {
        let opened = Opened::new()?;
        if manage::is_paused(&opened.state)? {
            return Ok(PersonalCloudSyncResult::simple("paused"));
        }
        match opened.catalogue()?.game(&game_id) {
            Ok(game) => sync_game(&opened, &game.clone(), after_play),
            Err(_) => Ok(PersonalCloudSyncResult::simple("not_in_catalogue")),
        }
    })
    .await
}

/// After a first session, finds the saves the game wrote and starts syncing them.
#[napi]
pub async fn personal_cloud_learn_after_play(game_id: String, started_at_ms: f64) -> napi::Result<PersonalCloudSyncResult> {
    blocking(move || {
        let opened = Opened::new()?;
        let mut catalogue = opened.catalogue()?;
        if let Ok(game) = catalogue.game(&game_id) {
            return sync_game(&opened, &game.clone(), true);
        }
        let device = opened.device()?;
        let link = device.links.get(&game_id).cloned().unwrap_or_default();
        let roots = device.roots_for(&game_id, None);
        let name = link.name.clone().unwrap_or_else(|| game_id.clone());
        let exe = link.exe.clone().context("link the game first")?;
        let stem = exe.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let started = UNIX_EPOCH + Duration::from_millis(started_at_ms.max(0.0) as u64);
        let found = match detect::learn(started.min(SystemTime::now()), &[name.clone(), stem], &roots) {
            Learned::Found(found) => found,
            Learned::Nothing => return Ok(PersonalCloudSyncResult::simple("learning")),
            Learned::Unclear(options) => {
                return Ok(PersonalCloudSyncResult { unclear: options, ..PersonalCloudSyncResult::simple("learning") })
            }
        };
        log_line(&opened.log(), &format!("{game_id} saves at {} from {}", found.save.key(), found.how));
        let exe_name = exe.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| game_id.clone());
        let game = Game { id: game_id.clone(), name, exe: exe_name, saves: vec![found.save] };
        catalogue.upsert(game.clone());
        catalogue.save(&opened.app.catalogue_path)?;
        opened.catalogue()?;
        sync_game(&opened, &game, false)
    })
    .await
}

static PLAYING: OnceLock<Mutex<HashMap<String, Playing>>> = OnceLock::new();

fn playing() -> &'static Mutex<HashMap<String, Playing>> {
    PLAYING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Marks a game as running, so Cloud Save Manager's watcher leaves it alone.
#[napi]
pub fn personal_cloud_playing_start(game_id: String) -> napi::Result<()> {
    let app = open_app().map_err(to_napi)?;
    let marker = Playing::start(&app.state_dir, &game_id).map_err(to_napi)?;
    playing().lock().map_err(|_| Error::from_reason("playing state is unavailable"))?.insert(game_id, marker);
    Ok(())
}

#[napi]
pub fn personal_cloud_playing_stop(game_id: String) -> napi::Result<()> {
    playing().lock().map_err(|_| Error::from_reason("playing state is unavailable"))?.remove(&game_id);
    Ok(())
}

// Versions and status for the game page

#[napi(object)]
pub struct PersonalCloudVersion {
    pub id: String,
    pub device: String,
    pub created_ms: f64,
    pub size: f64,
    pub file_count: u32,
    pub pinned: bool,
    pub is_current: bool,
}

#[napi(object)]
pub struct PersonalCloudSettled {
    pub at_ms: f64,
    pub kept_local: bool,
    pub other_version: Option<String>,
}

#[napi(object)]
pub struct PersonalCloudGameInfo {
    pub game_id: String,
    pub name: String,
    pub in_catalogue: bool,
    /// up_to_date, playing, upload_waiting, cloud_newer, both_changed, no_saves_yet,
    /// waiting_for_first_launch, not_on_this_device or offline.
    pub status: String,
    pub status_label: String,
    pub save_location: Option<String>,
    pub folder: Option<String>,
    pub local_files: u32,
    pub local_bytes: f64,
    pub versions: Vec<PersonalCloudVersion>,
    pub settled: Option<PersonalCloudSettled>,
}

fn status_key(status: SyncStatus) -> &'static str {
    match status {
        SyncStatus::UpToDate => "up_to_date",
        SyncStatus::Playing => "playing",
        SyncStatus::UploadWaiting => "upload_waiting",
        SyncStatus::CloudNewer => "cloud_newer",
        SyncStatus::BothChanged => "both_changed",
        SyncStatus::NoSavesYet => "no_saves_yet",
        SyncStatus::WaitingForFirstLaunch => "waiting_for_first_launch",
        SyncStatus::NotOnThisDevice => "not_on_this_device",
        SyncStatus::Offline => "offline",
    }
}

fn to_version(version: &Version, head: Option<&str>) -> PersonalCloudVersion {
    PersonalCloudVersion {
        id: version.id.clone(),
        device: version.device.clone(),
        created_ms: version.created_ms as f64,
        size: version.size as f64,
        file_count: version.file_count as u32,
        pinned: version.pinned,
        is_current: head == Some(version.id.as_str()),
    }
}

#[napi]
pub async fn personal_cloud_game_info(game_id: String) -> napi::Result<PersonalCloudGameInfo> {
    blocking(move || {
        let opened = Opened::new()?;
        let catalogue = opened.catalogue()?;
        let Ok(game) = catalogue.game(&game_id) else {
            let name = opened.device()?.links.get(&game_id).and_then(|l| l.name.clone()).unwrap_or_else(|| game_id.clone());
            return Ok(PersonalCloudGameInfo {
                game_id,
                name,
                in_catalogue: false,
                status: "no_saves_yet".into(),
                status_label: SyncStatus::NoSavesYet.label().into(),
                save_location: None,
                folder: None,
                local_files: 0,
                local_bytes: 0.0,
                versions: Vec::new(),
                settled: None,
            });
        };
        let info = manage::inspect(&opened.engine(), game, &opened.device()?, &opened.app.state_dir)?;
        Ok(PersonalCloudGameInfo {
            game_id: info.id,
            name: info.name,
            in_catalogue: true,
            status: status_key(info.status).into(),
            status_label: info.status.label().into(),
            save_location: game.saves.first().map(|save| save.key()),
            folder: info.folder.map(|f| f.to_string_lossy().into_owned()),
            local_files: info.local_files as u32,
            local_bytes: info.local_bytes as f64,
            versions: info.versions.iter().map(|v| to_version(v, info.head.as_deref())).collect(),
            settled: info.settled.map(|s| PersonalCloudSettled {
                at_ms: s.at_ms as f64,
                kept_local: s.kept_local,
                other_version: s.other_version,
            }),
        })
    })
    .await
}

fn with_game<T, F>(game_id: String, work: F) -> impl FnOnce() -> Result<T>
where
    F: FnOnce(&Opened, &Game) -> Result<T>,
{
    move || {
        let opened = Opened::new()?;
        let game = opened.game(&game_id)?;
        work(&opened, &game)
    }
}

/// Makes this device's save current on every device. The old one stays in history.
#[napi]
pub async fn personal_cloud_force_upload(game_id: String) -> napi::Result<PersonalCloudVersion> {
    blocking(with_game(game_id, |opened, game| {
        let roots = opened.device()?.roots_for(&game.id, None);
        let version = manage::force_upload(&opened.engine(), game, &roots, &opened.app.state_dir)?;
        Ok(to_version(&version, Some(version.id.as_str())))
    }))
    .await
}

/// Replaces this device's save with the cloud's. Local changes stay in history.
#[napi]
pub async fn personal_cloud_force_download(game_id: String) -> napi::Result<PersonalCloudVersion> {
    blocking(with_game(game_id, |opened, game| {
        let roots = opened.device()?.roots_for(&game.id, None);
        let version = manage::force_download(&opened.engine(), game, &roots, &opened.app.state_dir)?;
        Ok(to_version(&version, Some(version.id.as_str())))
    }))
    .await
}

/// Makes an older version current on every device.
#[napi]
pub async fn personal_cloud_restore_version(game_id: String, version_id: String) -> napi::Result<PersonalCloudVersion> {
    blocking(with_game(game_id, move |opened, game| {
        let roots = opened.device()?.roots_for(&game.id, None);
        let version = manage::restore_version(&opened.engine(), game, &roots, &version_id, &opened.app.state_dir)?;
        Ok(to_version(&version, Some(version.id.as_str())))
    }))
    .await
}

#[napi]
pub async fn personal_cloud_delete_version(game_id: String, version_id: String) -> napi::Result<()> {
    blocking(with_game(game_id, move |opened, game| manage::delete_version(&opened.store, &game.id, &version_id)))
        .await
}

// Hydra's own files in Drive, such as synced settings

fn hydra_key(key: &str) -> Result<String> {
    let key = key.trim_start_matches('/');
    if !key.starts_with(HYDRA_PREFIX)
        || key.len() == HYDRA_PREFIX.len()
        || key.ends_with('/')
        || key.split('/').any(|part| part.is_empty() || part == "." || part == "..")
        || key.contains('\\')
    {
        bail!("cloud file keys must be inside {HYDRA_PREFIX}");
    }
    Ok(key.to_string())
}

#[napi]
pub async fn personal_cloud_read_file(key: String) -> napi::Result<Option<Buffer>> {
    blocking(move || {
        let key = hydra_key(&key)?;
        let app = open_app()?;
        Ok(app.remote()?.get(&key)?.map(Buffer::from))
    })
    .await
}

#[napi]
pub async fn personal_cloud_write_file(key: String, data: Buffer) -> napi::Result<()> {
    let data = data.to_vec();
    blocking(move || {
        let key = hydra_key(&key)?;
        let app = open_app()?;
        app.remote()?.put(&key, &data)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use cloud_save_manager::catalogue::SaveDef;
    use cloud_save_manager::roots::Root;

    fn game(id: &str, name: &str, exe: &str) -> Game {
        Game { id: id.into(), name: name.into(), exe: exe.into(), saves: vec![SaveDef::new(Root::LocalAppdata, id)] }
    }

    #[test]
    fn matches_a_distinct_exe_regardless_of_case() {
        let catalogue = Catalogue { schema: 1, games: vec![game("zelda", "Zelda 64: Recompiled", "Zelda64Recompiled.exe")] };
        assert_eq!(find_catalogued(&catalogue, "zelda64recompiled.EXE", "Anything").map(|g| g.id.as_str()), Some("zelda"));
    }

    #[test]
    fn a_generic_exe_also_needs_the_name_to_match() {
        let catalogue = Catalogue { schema: 1, games: vec![game("one", "First Game", "Game.exe")] };
        assert!(find_catalogued(&catalogue, "game.exe", "Second Game").is_none());
        assert_eq!(find_catalogued(&catalogue, "game.exe", "First Game").map(|g| g.id.as_str()), Some("one"));
    }

    #[test]
    fn new_ids_never_reuse_a_catalogue_id() {
        let catalogue = Catalogue { schema: 1, games: vec![game("drive-rally", "Drive Rally", "DriveRally.exe")] };
        assert_eq!(unique_id(&catalogue, "Drive Rally"), "drive-rally-2");
    }

    #[test]
    fn cloud_file_keys_stay_inside_the_hydra_folder() {
        assert_eq!(hydra_key("hydra/settings.json").unwrap(), "hydra/settings.json");
        for bad in ["catalogue.json", "hydra/", "hydra/../catalogue.json", "hydra//x", "games/x/head.json", "hydra\\x"] {
            assert!(hydra_key(bad).is_err(), "{bad} should be refused");
        }
    }
}
