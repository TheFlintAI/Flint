// Tauri command channel constants.

export const TAURI_COMMANDS = {
  // App
  APP_HOMEDIR: 'app:homedir',

  // API Streaming
  API_STREAM_REQUEST: 'api:stream-request',
  API_STREAM_CHUNK: 'api:stream-chunk',
  API_STREAM_END: 'api:stream-end',
  API_STREAM_ERROR: 'api:stream-error',
  API_QUOTA_UPDATE: 'api:quota-update',
  API_ACCOUNT_RATE_LIMITED: 'api:account-rate-limited',

  // File System
  FS_SELECT_FILE: 'fs:select-file',
  FS_SELECT_SAVE_FILE: 'fs:select-save-file',
  FS_READ_DOCUMENT: 'fs:read-document',
  FS_READ_FILE: 'fs:read-file',
  FS_STAT_PATH: 'fs:stat-path',
  FS_WRITE_FILE: 'fs:write-file',
  FS_LIST_DIR: 'fs:list-dir',
  FS_MKDIR: 'fs:mkdir',
  FS_DELETE: 'fs:delete',
  FS_MOVE: 'fs:move',
  FS_SELECT_FOLDER: 'fs:select-folder',
  FS_GLOB: 'fs:glob',
  FS_GREP: 'fs:grep',

  // File Watching
  FS_WATCH_FILE: 'fs:watch-file',
  FS_UNWATCH_FILE: 'fs:unwatch-file',
  FS_FILE_CHANGED: 'fs:file-changed',
  FS_READ_FILE_BINARY: 'fs:read-file-binary',
  FS_WRITE_FILE_BINARY: 'fs:write-file-binary',

  // Shell
  SHELL_EXEC: 'shell:exec',
  SHELL_STARTED: 'shell:started',
  SHELL_OUTPUT: 'shell:output',
  SHELL_OPEN_PATH: 'shell:openPath',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',

  // Local Terminal
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_LIST: 'terminal:list',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_EXIT: 'terminal:exit',

  // Agent Changes
  AGENT_CHANGES_LIST_TASK: 'agent:changes:list-task',
  AGENT_CHANGES_DIFF_CONTENT: 'agent:changes:diff-content',
  AGENT_CHANGES_UNDO_RUN: 'agent:changes:undo-run',
  AGENT_CHANGES_UNDO_FILE: 'agent:changes:undo-file',

  // Process Management
  PROCESS_SPAWN: 'process:spawn',
  PROCESS_KILL: 'process:kill',
  PROCESS_WRITE: 'process:write',
  PROCESS_STATUS: 'process:status',
  PROCESS_LIST: 'process:list',
  PROCESS_OUTPUT: 'process:output',

  // Plugin System
  PLUGIN_LIST: 'plugin:list',
  PLUGIN_ENABLE: 'plugin:enable',
  PLUGIN_DISABLE: 'plugin:disable',
  PLUGIN_DISCOVER: 'plugin:discover',
  PLUGIN_GET_SOURCE: 'plugin:get-source',
  PLUGIN_GET_RUNTIME: 'plugin:get-runtime',
  PLUGIN_IMPORT_FLP: 'plugin:import-flp',
  PLUGIN_SET_SETTING: 'plugin:set-setting',
  PLUGIN_GET_STATE: 'plugin:get-state',
  PLUGIN_SET_STATE: 'plugin:set-state',
  PLUGIN_DELETE_STATE: 'plugin:delete-state',
  PLUGIN_UNINSTALL: 'plugin:uninstall',

  // Git
  GIT_GET_HEAD: 'git:get-head',
  GIT_GET_RANGE_COMMITS: 'git:get-range-commits',
  GIT_GET_CHANGED_FILES: 'git:get-changed-files',
  GIT_GET_STATUS: 'git:get-status',
  GIT_SCAN_REPOSITORIES: 'git:scan-repositories',
  GIT_GET_REPO_SUMMARY: 'git:get-repo-summary',
  GIT_GET_STATUS_DETAILED: 'git:get-status-detailed',
  GIT_GET_FILE_DIFF: 'git:get-file-diff',
  GIT_GET_FILE_DIFF_AT_COMMIT: 'git:get-file-diff-at-commit',
  GIT_GET_STAGED_DIFF_BUNDLE: 'git:get-staged-diff-bundle',
  GIT_GET_COMMIT_HISTORY: 'git:get-commit-history',
  GIT_LIST_BRANCHES: 'git:list-branches',
  GIT_FETCH: 'git:fetch',
  GIT_PULL_REBASE: 'git:pull-rebase',
  GIT_PUSH: 'git:push',
  GIT_GET_FILE_HISTORY: 'git:get-file-history',
  GIT_CREATE_BRANCH: 'git:create-branch',
  GIT_CHECKOUT_BRANCH: 'git:checkout-branch',
  GIT_MERGE_BRANCH: 'git:merge-branch',
  GIT_REBASE_BRANCH: 'git:rebase-branch',
  GIT_DELETE_LOCAL_BRANCH: 'git:delete-local-branch',
  GIT_DELETE_REMOTE_BRANCH: 'git:delete-remote-branch',
  GIT_RENAME_BRANCH: 'git:rename-branch',
  GIT_STAGE_FILES: 'git:stage-files',
  GIT_UNSTAGE_FILES: 'git:unstage-files',
  GIT_STAGE_ALL: 'git:stage-all',
  GIT_UNSTAGE_ALL: 'git:unstage-all',
  GIT_DISCARD_FILES: 'git:discard-files',
  GIT_COMMIT: 'git:commit',
  CHAT_TASK_UPDATED: 'chat:task-updated',
  CHAT_TASK_DELETED: 'chat:task-deleted',

  // Skills
  SKILLS_LIST: 'skills:list',
  SKILLS_LOAD: 'skills:load',
  SKILLS_DELETE: 'skills:delete',
  SKILLS_SET_ENABLED: 'skills:set-enabled',
  SKILLS_OPEN_FOLDER: 'skills:open-folder',
  SKILLS_ADD_FROM_FOLDER: 'skills:add-from-folder',
  SKILLS_PREVIEW: 'skills:preview',
  SKILLS_SCAN_WORKSPACE: 'skills:scan-workspace',

  // Prompts
  PROMPTS_LIST: 'prompts:list',
  PROMPTS_LOAD: 'prompts:load',

  // Agents
  AGENTS_MANAGE_LIST: 'agents:manage-list',
  AGENTS_MANAGE_READ: 'agents:manage-read',
  AGENTS_MANAGE_SAVE: 'agents:manage-save',

  // Commands
  COMMANDS_LIST: 'commands:list',
  COMMANDS_LOAD: 'commands:load',
  COMMANDS_MANAGE_LIST: 'commands:manage-list',
  COMMANDS_MANAGE_READ: 'commands:manage-read',
  COMMANDS_MANAGE_CREATE: 'commands:manage-create',
  COMMANDS_MANAGE_SAVE: 'commands:manage-save',

  // Clipboard
  CLIPBOARD_WRITE_IMAGE: 'clipboard:write-image',
  WINDOW_CAPTURE_REGION: 'window:capture-region',
  TASK_RUNTIME_SYNC: 'task-runtime:sync',
  AGENT_RUNTIME_SYNC: 'agent-runtime:sync',

  // Images
  IMAGE_PERSIST_GENERATED: 'image:persist-generated',
  IMAGE_CREATE_GIF_FROM_GRID: 'image:create-gif-from-grid',

  // Desktop Control
  DESKTOP_SCREENSHOT_CAPTURE: 'desktop:screenshot:capture',
  DESKTOP_INPUT_CLICK: 'desktop:input:click',
  DESKTOP_INPUT_TYPE: 'desktop:input:type',
  DESKTOP_INPUT_SCROLL: 'desktop:input:scroll',

  // Memory (Vector DB)
  MEMORY_LIST: 'memory:list',
  MEMORY_READ: 'memory:read',
  MEMORY_SEARCH: 'memory:search',
  MEMORY_WRITE: 'memory:write',
  MEMORY_DELETE: 'memory:delete',
  MEMORY_STATS: 'memory:stats',
  MEMORY_REBUILD_INDEX: 'memory:rebuild-index',

} as const

export type TauriCommandChannel = (typeof TAURI_COMMANDS)[keyof typeof TAURI_COMMANDS]
