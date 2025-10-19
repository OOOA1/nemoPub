// server/leadFlow.ts
import { storage } from "./storage";

const formKey = (userId: number) => `flow_state_${userId}`;
const dataKey = (userId: number) => `lead_form_${userId}`;

export async function getFlowState(userId: number): Promise<string> {
  const v: string | undefined = await storage.getBotSetting(formKey(userId));
  return v ?? "";
}

export async function setFlowState(userId: number, state: string): Promise<void> {
  await storage.setBotSetting(formKey(userId), state);
}

export async function clearFlowState(userId: number): Promise<void> {
  await storage.setBotSetting(formKey(userId), "");
}

export async function getLeadData(userId: number): Promise<any> {
  const raw: string | undefined = await storage.getBotSetting(dataKey(userId));
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

export async function setLeadData(userId: number, data: any): Promise<void> {
  await storage.setBotSetting(dataKey(userId), JSON.stringify(data));
}

export async function clearLeadData(userId: number): Promise<void> {
  await storage.setBotSetting(dataKey(userId), "");
}
