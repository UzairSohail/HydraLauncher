import { registerEvent } from "../register-event";
import { getUserPreferences } from "@main/services/user-preferences";

registerEvent("getUserPreferences", () => getUserPreferences());
