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

export interface FinalAction {
  readonly type: "final";
  readonly message: string;
  readonly summary: string[];
}

export type AgentAction = ToolCallAction | FinalAction;

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
  finalMessage?: string;
}

export interface AgentRunResult {
  readonly steps: number;
  readonly final: FinalAction;
  readonly usage: {
    totalInputTokens: number;
    totalOutputTokens: number;
    prompts: PromptLogEntry[];
  };
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
  readonly make_directory: {
    path: string;
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
  readonly make_directory: {
    path: string;
    created: true;
  };
}

export type ToolName = keyof ToolInputByName;
