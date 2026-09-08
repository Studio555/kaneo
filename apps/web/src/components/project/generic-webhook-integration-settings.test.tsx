import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenericWebhookIntegrationSettings } from "./generic-webhook-integration-settings";

const datesEnabled = vi.hoisted(() => ({ value: true }));

vi.mock("@/hooks/use-dates-enabled", () => ({
  useDatesEnabled: () => datesEnabled.value,
  useShowDueDates: () => datesEnabled.value,
}));

// biome-ignore lint/suspicious/noExplicitAny: test-only stand-in for the query's response shape
const integrationQuery = vi.hoisted(() => ({ data: null as any }));

const createIntegration = vi.fn();
const updateIntegration = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock(
  "@/hooks/queries/generic-webhook-integration/use-get-generic-webhook-integration",
  () => ({
    default: () => ({ data: integrationQuery.data, isLoading: false }),
  }),
);

vi.mock(
  "@/hooks/mutations/generic-webhook-integration/use-generic-webhook-integration",
  () => ({
    useCreateGenericWebhookIntegration: () => ({
      mutateAsync: createIntegration,
      isPending: false,
    }),
    useUpdateGenericWebhookIntegration: () => ({
      mutateAsync: updateIntegration,
      isPending: false,
    }),
    useDeleteGenericWebhookIntegration: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  }),
);

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("GenericWebhookIntegrationSettings", () => {
  afterEach(cleanup);

  beforeEach(() => {
    datesEnabled.value = true;
    integrationQuery.data = null;
    createIntegration.mockReset();
    createIntegration.mockResolvedValue(undefined);
    updateIntegration.mockReset();
    updateIntegration.mockResolvedValue(undefined);
  });

  it("creates an opt-in project reminder webhook with its lead time", async () => {
    render(<GenericWebhookIntegrationSettings projectId="project-1" />);

    fireEvent.change(
      screen.getByLabelText("settings:genericWebhookIntegration.webhookLabel"),
      { target: { value: "https://example.com/hooks/kaneo" } },
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:genericWebhookIntegration.events.dueDateReminder",
      }),
    );
    fireEvent.change(
      screen.getByLabelText(
        "settings:genericWebhookIntegration.reminderLeadTimeLabel",
      ),
      { target: { value: "48" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:genericWebhookIntegration.connect",
      }),
    );

    await waitFor(() =>
      expect(createIntegration).toHaveBeenCalledWith({
        projectId: "project-1",
        data: expect.objectContaining({
          webhookUrl: "https://example.com/hooks/kaneo",
          dueDateReminderLeadTimeMinutes: 2880,
          events: expect.objectContaining({
            dueDateReminder: true,
            taskDeleted: false,
            taskMoved: false,
            taskDueDateChanged: false,
            taskAssigneeChanged: false,
            taskUnassigned: false,
          }),
        }),
      }),
    );
  });

  it("creates a webhook with the opt-in task lifecycle events enabled", async () => {
    render(<GenericWebhookIntegrationSettings projectId="project-1" />);

    fireEvent.change(
      screen.getByLabelText("settings:genericWebhookIntegration.webhookLabel"),
      { target: { value: "https://example.com/hooks/kaneo" } },
    );
    for (const event of [
      "taskDeleted",
      "taskMoved",
      "taskDueDateChanged",
      "taskAssigneeChanged",
      "taskUnassigned",
    ]) {
      fireEvent.click(
        screen.getByRole("switch", {
          name: `settings:genericWebhookIntegration.events.${event}`,
        }),
      );
    }
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:genericWebhookIntegration.connect",
      }),
    );

    await waitFor(() =>
      expect(createIntegration).toHaveBeenCalledWith({
        projectId: "project-1",
        data: expect.objectContaining({
          events: expect.objectContaining({
            taskDeleted: true,
            taskMoved: true,
            taskDueDateChanged: true,
            taskAssigneeChanged: true,
            taskUnassigned: true,
          }),
        }),
      }),
    );
  });

  it("submits other webhook settings after an invalid reminder time is disabled", async () => {
    render(<GenericWebhookIntegrationSettings projectId="project-1" />);

    fireEvent.change(
      screen.getByLabelText("settings:genericWebhookIntegration.webhookLabel"),
      { target: { value: "https://example.com/hooks/kaneo" } },
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:genericWebhookIntegration.events.dueDateReminder",
      }),
    );
    fireEvent.change(
      screen.getByLabelText(
        "settings:genericWebhookIntegration.reminderLeadTimeLabel",
      ),
      { target: { value: "0" } },
    );
    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings:genericWebhookIntegration.events.dueDateReminder",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:genericWebhookIntegration.connect",
      }),
    );

    await waitFor(() =>
      expect(createIntegration).toHaveBeenCalledWith({
        projectId: "project-1",
        data: expect.objectContaining({
          webhookUrl: "https://example.com/hooks/kaneo",
          events: expect.objectContaining({ dueDateReminder: false }),
        }),
      }),
    );
    expect(createIntegration.mock.calls[0]?.[0].data).not.toHaveProperty(
      "dueDateReminderLeadTimeMinutes",
    );
  });
});

describe("GenericWebhookIntegrationSettings with dates disabled", () => {
  afterEach(cleanup);

  beforeEach(() => {
    datesEnabled.value = true;
    integrationQuery.data = null;
    createIntegration.mockReset();
    createIntegration.mockResolvedValue(undefined);
    updateIntegration.mockReset();
    updateIntegration.mockResolvedValue(undefined);
  });

  it("omits the due-date event controls", () => {
    datesEnabled.value = false;
    render(<GenericWebhookIntegrationSettings projectId="project-1" />);

    expect(
      screen.queryByRole("switch", {
        name: "settings:genericWebhookIntegration.events.dueDateReminder",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(
        "settings:genericWebhookIntegration.reminderLeadTimeLabel",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("switch", {
        name: "settings:genericWebhookIntegration.events.taskDueDateChanged",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows the due-date event controls when dates are enabled", () => {
    datesEnabled.value = true;
    render(<GenericWebhookIntegrationSettings projectId="project-1" />);

    expect(
      screen.getByRole("switch", {
        name: "settings:genericWebhookIntegration.events.dueDateReminder",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", {
        name: "settings:genericWebhookIntegration.events.taskDueDateChanged",
      }),
    ).toBeInTheDocument();
  });

  it("saves a stored due-date reminder configuration unchanged while its controls are hidden", async () => {
    datesEnabled.value = false;
    integrationQuery.data = {
      webhookConfigured: true,
      events: {
        taskCreated: true,
        taskStatusChanged: true,
        taskPriorityChanged: false,
        taskTitleChanged: false,
        taskDescriptionChanged: false,
        taskCommentCreated: true,
        taskDeleted: false,
        taskMoved: false,
        taskDueDateChanged: false,
        taskAssigneeChanged: false,
        taskUnassigned: false,
        dueDateReminder: true,
      },
      dueDateReminderLeadTimeMinutes: 2880,
    };

    render(<GenericWebhookIntegrationSettings projectId="project-1" />);

    // The stored config already has a reminder enabled, but its controls
    // must not render while dates are disabled.
    expect(
      screen.queryByRole("switch", {
        name: "settings:genericWebhookIntegration.events.dueDateReminder",
      }),
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByLabelText("settings:genericWebhookIntegration.webhookLabel"),
      { target: { value: "https://example.com/hooks/kaneo" } },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings:genericWebhookIntegration.saveChanges",
      }),
    );

    await waitFor(() =>
      expect(updateIntegration).toHaveBeenCalledWith({
        projectId: "project-1",
        json: expect.objectContaining({
          webhookUrl: "https://example.com/hooks/kaneo",
          dueDateReminderLeadTimeMinutes: 2880,
          events: expect.objectContaining({
            dueDateReminder: true,
          }),
        }),
      }),
    );
  });
});
