import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { Project } from "../../protocol";
import { projectKeys } from "./keys";
import { terminalKeys } from "../terminals/keys";

async function fetchProjects(): Promise<Project[]> {
  return api.projects();
}

export function useProjectsQuery() {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: fetchProjects,
    staleTime: 30000,
    placeholderData: (previous) => previous,
  });
}

function projectFor(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  const project = queryClient
    .getQueryData<Project[]>(projectKeys.list())
    ?.find((candidate) => candidate.id === id);
  if (!project) throw new Error("Project is no longer available");
  return project;
}

export function useToggleProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, expanded }: { projectId: string; expanded: boolean }) => {
      const project = projectFor(queryClient, projectId);
      return api.updateProject(projectId, { ...project, expanded });
    },
    onMutate: async ({ projectId, expanded }) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.list() });
      const previous = queryClient.getQueryData<Project[]>(projectKeys.list());
      queryClient.setQueryData<Project[]>(projectKeys.list(), (old) =>
        old?.map((project) =>
          project.id === projectId ? { ...project, expanded } : project
        )
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(projectKeys.list(), context.previous);
      }
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => api.deleteProject(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
      void queryClient.invalidateQueries({ queryKey: terminalKeys.all });
    },
  });
}

export function useRenameProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, newName }: { projectId: string; newName: string }) => {
      const project = projectFor(queryClient, projectId);
      return api.updateProject(projectId, { ...project, name: newName });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      name,
      workingDirectory,
    }: {
      projectId: string;
      name?: string;
      workingDirectory?: string;
    }) => {
      const project = projectFor(queryClient, projectId);
      return api.updateProject(projectId, {
        ...project,
        name: name ?? project.name,
        working_directory: workingDirectory ?? project.working_directory,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
      void queryClient.invalidateQueries({ queryKey: terminalKeys.all });
    },
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; workingDirectory: string }) =>
      api.createProject({
        name: data.name,
        working_directory: data.workingDirectory,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}
