export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface OllamaUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface OllamaCallResult {
  readonly content: string;
  readonly usage: OllamaUsage;
}

export interface ToolCallAction {
  readonly type: "tool_call";
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly reason: string;
}

export interface PlanAction {
  readonly type: "plan";
  readonly steps: string[];
  readonly message?: string;
}

export interface FinalAction {
  readonly type: "final";
  readonly message: string;
  readonly summary: string[];
}

export type AgentAction = ToolCallAction | PlanAction | FinalAction;

export interface PromptLogEntry {
  readonly step: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requested: string;
  readonly responseType: AgentAction["type"];
  readonly responsePreview: string;
  tool?: string;
  reason?: string;
  toolInput?: string;
  planSteps?: string[];
  planMessage?: string;
  finalMessage?: string;
}

export interface AgentRunOptions {
  readonly maxSteps?: number;
  readonly trace?: boolean;
  readonly traceDirectory?: string;
  readonly outputRoot?: string;
}

export interface AgentRunResult {
  readonly steps: number;
  readonly final: FinalAction;
  readonly tracePath?: string;
  readonly usage: {
    totalInputTokens: number;
    totalOutputTokens: number;
    prompts: PromptLogEntry[];
  };
}

export interface AgentTraceStep {
  readonly step: number;
  readonly requested: string;
  readonly rawResponse: string;
  readonly action: AgentAction;
  readonly toolResult?: unknown;
  readonly usage: OllamaUsage;
}

export interface AgentTrace {
  readonly goal: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly maxSteps: number;
  readonly outputRoot: string;
  readonly steps: AgentTraceStep[];
  readonly final?: FinalAction;
  readonly error?: string;
  readonly usage: AgentRunResult["usage"];
}

export interface ToolResultEnvelope {
  readonly type: "tool_result";
  readonly tool: string;
  readonly result: unknown;
}

export interface ToolDefinition<Name extends string = string> {
  readonly name: Name;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, string>>;
}

export interface DirectoryEntry {
  readonly name: string;
  readonly type: "directory" | "file";
}

export interface ToolInputByName {
  readonly list_files: {
    path?: string;
  };
  readonly read_file: {
    path: string;
  };
  readonly write_file: {
    path: string;
    content: string;
  };
  readonly replace_in_file: {
    path: string;
    search: string;
    replacement: string;
  };
  readonly make_directory: {
    path: string;
  };
  readonly run_command: {
    command: string;
  };
}

export interface ToolResultByName {
  readonly list_files: {
    path: string;
    entries: DirectoryEntry[];
  };
  readonly read_file: {
    path: string;
    content: string;
  };
  readonly write_file: {
    path: string;
    bytesWritten: number;
  };
  readonly replace_in_file: {
    path: string;
    replacements: number;
    bytesWritten: number;
  };
  readonly make_directory: {
    path: string;
    created: true;
  };
  readonly run_command: {
    command: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  };
}

export type ToolName = keyof ToolInputByName;

export interface ToolRunOptions {
  readonly outputRoot?: string;
}
