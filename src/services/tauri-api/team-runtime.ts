import type {
  AppendTeamRuntimeMessageArgs,
  ConsumeTeamRuntimeMessagesArgs,
  CreateTeamRuntimeArgs,
  DeleteTeamRuntimeArgs,
  TeamRuntimeCreateResult,
  TeamRuntimeMessageRecord
} from '@/protocols/team-runtime-types'
import { tauriCommands } from './command-client'

export function createTeamRuntime(args: CreateTeamRuntimeArgs): Promise<TeamRuntimeCreateResult> {
  return tauriCommands.invoke('team-runtime:create', args)
}

export function deleteTeamRuntime(args: DeleteTeamRuntimeArgs): Promise<{ success: true }> {
  return tauriCommands.invoke('team-runtime:delete', args)
}

export function appendTeamRuntimeMessage(
  args: AppendTeamRuntimeMessageArgs
): Promise<{ success: true }> {
  return tauriCommands.invoke('team-runtime:message:append', args)
}

export function consumeTeamRuntimeMessages(
  args: ConsumeTeamRuntimeMessagesArgs
): Promise<TeamRuntimeMessageRecord[]> {
  return tauriCommands.invoke('team-runtime:messages:consume', args)
}
