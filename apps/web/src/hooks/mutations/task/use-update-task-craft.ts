import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskCraft from "@/fetchers/task/update-task-craft";

export function useUpdateTaskCraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      craftId,
    }: {
      taskId: string;
      craftId: string | null;
      projectId: string;
    }) => updateTaskCraft(taskId, craftId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["task", variables.taskId] });
      queryClient.invalidateQueries({
        queryKey: ["tasks", variables.projectId],
      });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({
        queryKey: ["activities", variables.taskId],
      });
    },
  });
}
