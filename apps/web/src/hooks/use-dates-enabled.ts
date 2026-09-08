import useGetConfig from "@/hooks/queries/config/use-get-config";
import { useUserPreferencesStore } from "@/store/user-preferences";

/**
 * Whether this instance has date features enabled.
 *
 * Defaults to false while the config query is in flight. On an instance where
 * dates are disabled this means the UI never renders date controls and then
 * yanks them away; the cost is that on a normal instance with a cold cache the
 * date UI appears a beat late, which is the better of the two flashes.
 */
export function useDatesEnabled(): boolean {
  const { data: config } = useGetConfig();
  return config?.datesEnabled === true;
}

/** The user's due-date display preference, gated by the instance flag. */
export function useShowDueDates(): boolean {
  const datesEnabled = useDatesEnabled();
  const showDueDates = useUserPreferencesStore((state) => state.showDueDates);
  return datesEnabled && showDueDates;
}
