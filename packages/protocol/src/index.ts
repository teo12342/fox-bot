import { z } from 'zod';
export const PROTOCOL_VERSION = 1;
export type RunStatus = 'queued'|'running'|'awaiting_input'|'awaiting_approval'|'completed'|'failed'|'cancelled';
export type ProviderKind = 'openrouter'|'openai'|'anthropic'|'gemini'|'xai'|'compatible'|'ollama';
export interface Bot { id:string; name:string; avatar:string; role:string; instructions:string; providerId:string; model:string; pinned:boolean; hidden:boolean; revision:number; createdAt:string; }
export interface Conversation { id:string; title:string; botIds:string[]; group:boolean; draft:string; updatedAt:string; }
export interface Attachment { id:string; name:string; mime:string; size:number; }
export interface Message { id:string; conversationId:string; botId?:string; role:'user'|'assistant'|'tool'|'system'; content:string; createdAt:string; runId?:string; replyTo?:string; reactions:Record<string,number>; attachments:Attachment[]; }
export interface Run { id:string; botId:string; conversationId:string; status:RunStatus; error?:string; startedAt:string; finishedAt?:string; parentRunId?:string; depth:number; }
export interface ToolCall { id:string; runId:string; name:string; args:Record<string,unknown>; status:'pending'|'running'|'completed'|'rejected'|'failed'; output?:string; }
export interface Skill { id:string; name:string; description:string; markdown:string; }
export interface Routine { id:string; botId:string; name:string; prompt:string; cron:string; timezone:string; enabled:boolean; nextRun:string; lastRun?:string; }
export interface MemoryEntry { id:string; botId:string; text:string; enabled:boolean; createdAt:string; }
export interface Artifact { id:string; runId:string; name:string; mime:string; size:number; createdAt:string; }
export interface ProviderProfile { id:string; kind:ProviderKind; name:string; baseUrl:string; hasCredential:boolean; }
export interface ApprovalRequest { id:string; runId:string; toolCallId:string; summary:string; status:'pending'|'approved'|'rejected'; createdAt:string; }
export interface PairedDevice { id:string; name:string; publicKey:string; createdAt:string; revoked:boolean; }
export interface Capabilities { text:boolean; tools:boolean; vision:boolean; audioInput:boolean; audioOutput:boolean; imageGeneration:boolean; }
export interface Model { id:string; name:string; capabilities:Capabilities; capabilitiesSource?:'provider'|'adapter'|'unknown'; contextLength?:number; }
export interface Snapshot { version:1; seq:number; bots:Bot[]; conversations:Conversation[]; messages:Message[]; runs:Run[]; tools:ToolCall[]; approvals:ApprovalRequest[]; providers:ProviderProfile[]; skills:Skill[]; routines:Routine[]; memories:MemoryEntry[]; artifacts:Artifact[]; devices:PairedDevice[]; }
export interface SyncEvent { version:1; seq:number; type:string; entityId:string; data:unknown; createdAt:string; }
export const commandSchema = z.object({ version:z.literal(1), id:z.string().uuid(), type:z.string().min(1).max(100), payload:z.record(z.string(),z.unknown()) });
export type Command = z.infer<typeof commandSchema>;
export interface CommandResult { id:string; ok:boolean; data?:unknown; error?:{code:string;message:string;current?:unknown}; }
export const pairingSchema = z.object({ version:z.literal(1), hostId:z.string().uuid(), endpoint:z.url().refine(v=>v.startsWith('wss://') || v.startsWith('ws://127.0.0.1:') || v.startsWith('ws://localhost:')), secret:z.string().min(32), expiresAt:z.number(), publicKey:z.string().min(32) });
export type PairingOffer = z.infer<typeof pairingSchema>;
export const SIGNALING_CONTRACT = { register:'{type:"register", id, hostId?, publicKey, nonce, signature, token?}', pair:'{type:"pair", hostId, secret, name}', signal:'{type:"signal", to, sessionId, seq, kind, payload, signature}', turn:'Authenticated WebSocket {type:"turn"}', health:'GET /health' } as const;
