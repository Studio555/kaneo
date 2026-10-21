import type { Control } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { EventChecklist } from "@/components/project/integrations/event-checklist/event-checklist";
import { FormField } from "@/components/ui/form";
import { useDatesEnabled } from "@/hooks/use-dates-enabled";
import { GENERIC_WEBHOOK_EVENT_ITEMS } from "./generic-webhook-events";
import type { GenericWebhookFormValues } from "./generic-webhook-form-values";
import { ReminderLeadTimeRow } from "./reminder-lead-time-row";

const DATE_EVENTS = new Set<string>(["taskDueDateChanged", "dueDateReminder"]);

type GenericWebhookEventChecklistProps = {
  control: Control<GenericWebhookFormValues>;
};

export function GenericWebhookEventChecklist({
  control,
}: GenericWebhookEventChecklistProps) {
  const { t } = useTranslation();
  const datesEnabled = useDatesEnabled();
  // Hidden date events keep their stored values; only the controls go away.
  const items = datesEnabled
    ? GENERIC_WEBHOOK_EVENT_ITEMS
    : GENERIC_WEBHOOK_EVENT_ITEMS.filter((item) => !DATE_EVENTS.has(item.id));

  return (
    <FormField
      control={control}
      name="events"
      render={({ field }) => (
        <EventChecklist
          columns={3}
          items={items}
          label={t("settings:genericWebhookIntegration.eventsTitle")}
          onChange={field.onChange}
          value={field.value}
        >
          {datesEnabled && field.value.dueDateReminder ? (
            <ReminderLeadTimeRow control={control} />
          ) : null}
        </EventChecklist>
      )}
    />
  );
}
