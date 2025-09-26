// AI Settings configuration - separate file to avoid circular dependencies

export interface AISettings {
  imageGenerationModel: string;
  imageQuality: string;
}

// Simple in-memory settings store (could be moved to database later)
const aiSettings: AISettings = {
  imageGenerationModel: "polza-nano-banana",
  imageQuality: "medium"
};

// Get current AI settings
export function getCurrentAISettings(): AISettings {
  return aiSettings;
}

// Update AI settings
export function updateAISettings(newSettings: Partial<AISettings>): AISettings {
  Object.assign(aiSettings, newSettings);
  return aiSettings;
}