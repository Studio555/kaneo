import useGetConfig from "@/hooks/queries/config/use-get-config";
import { useUserPreferencesStore } from "@/store/user-preferences";

/**
 * Whether this instance has date features enabled.
 *
 * Defaults to false while the config query is in flight. On an instance where
 * dates are disabled this means the UI never renders date controls and then
 * yanks them away; the cost is that on a normal instance with a cold cache the
 * date UI appears a beat late, which is the better of the two flashes.
 *
 * Once the config resolves, a missing `datesEnabled` field counts as enabled.
 * The web app and the API can be deployed separately, so a web build can reach
 * an API that predates the flag; treating that silence as "disabled" would hide
 * every date feature on an instance that never opted out. Only an explicit
 * `false` disables, matching how the published MCP package reads the same field.
 *
 * Only use this to decide what to *render*. Anything that navigates must use
 * `useDatesKnownDisabled()` instead: bouncing a user off a route because the
 * config hasn't arrived yet is not recoverable the way a late-rendering badge
 * is.
 */
export function useDatesEnabled(): boolean {
  const { data: config, isSuccess } = useGetConfig();
  if (!isSuccess) return false;
  return config?.datesEnabled !== false;
}

/**
 * Whether the instance config has actually resolved and says dates are off.
 *
 * Unlike `useDatesEnabled()`, this stays false while the config query is
 * pending or has failed, so a route guard can wait for a definite answer
 * instead of redirecting on a cold cache.
 */
export function useDatesKnownDisabled(): boolean {
  const { data: config } = useGetConfig();
  return config?.datesEnabled === false;
}

/** The user's due-date display preference, gated by the instance flag. */
export function useShowDueDates(): boolean {
  const datesEnabled = useDatesEnabled();
  const showDueDates = useUserPreferencesStore((state) => state.showDueDates);
  return datesEnabled && showDueDates;
}
