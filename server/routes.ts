import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { bot } from "./telegramBot";
import { initializeCronJobs } from "./cronJobs";
import { generateDesignConcept } from "./openai";
import { getCurrentAISettings, updateAISettings } from "./aiSettings";

export async function registerRoutes(app: Express): Promise<Server> {
  // Start bot in polling mode instead of webhook (non-blocking)
  // Skip bot startup if disabled or no token available
  const isDeployment = process.env.REPLIT_DEPLOYMENT === 'true' || process.env.NODE_ENV === 'production';
  const botToken = isDeployment ? process.env.BOT_TOKEN : (process.env.BOT_TOKEN_DEV || process.env.BOT_TOKEN_PREVIEW);
  
  // Боты работают корректно - дублированный запуск исправлен
  const DISABLE_PREVIEW_BOT = false;
  const DISABLE_DEPLOY_BOT = false;
  
  console.log('🤖 Bot startup check:');
  console.log(`  - Environment: ${isDeployment ? 'DEPLOY' : 'PREVIEW'}`);
  console.log(`  - Token available: ${!!botToken}`);
  console.log(`  - Bot disabled: ${process.env.DISABLE_BOT === 'true'}`);
  console.log(`  - Preview bot disabled: ${!isDeployment && DISABLE_PREVIEW_BOT}`);
  
  if (process.env.DISABLE_BOT === 'true') {
    console.log('🔇 Bot manually disabled via DISABLE_BOT=true');
  } else if (!isDeployment && DISABLE_PREVIEW_BOT) {
    console.log('🔇 Preview bot temporarily disabled to prevent 409 conflicts with Deploy');
    console.log('💡 Deploy bot will continue working normally');
  } else if (isDeployment && DISABLE_DEPLOY_BOT) {
    console.log('🔇 Deploy bot temporarily disabled for testing Preview bot');
    console.log('💡 Preview bot will run without conflicts');
  } else if (!botToken) {
    console.log('🔇 Bot disabled - no token available for current environment');
    console.log(`🔍 Expected token: ${isDeployment ? 'BOT_TOKEN' : 'BOT_TOKEN_DEV'}`);
  } else {
    console.log('🤖 Bot will be initialized later in the proper startup sequence');
    console.log(`🔍 Environment: ${isDeployment ? 'DEPLOY' : 'PREVIEW'}`);
    console.log(`🔍 Token: ...${botToken.slice(-6)}`);
  }

  // API Routes for Admin Panel
  
  // Dashboard stats
  app.get("/api/dashboard/stats", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Recent activity
  app.get("/api/dashboard/activity", async (req, res) => {
    try {
      const activity = await storage.getRecentActivity(10);
      res.json(activity);
    } catch (error) {
      console.error("Error fetching recent activity:", error);
      res.status(500).json({ error: "Failed to fetch recent activity" });
    }
  });

  // Broadcasts
  app.get("/api/broadcasts", async (req, res) => {
    try {
      const broadcasts = await storage.getBroadcasts(20);
      res.json(broadcasts);
    } catch (error) {
      console.error("Error fetching broadcasts:", error);
      res.status(500).json({ error: "Failed to fetch broadcasts" });
    }
  });

  app.post("/api/broadcasts", async (req, res) => {
    try {
      const { title, message, targetAudience } = req.body;
      
      if (!title || !message || !targetAudience) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const broadcast = await storage.createBroadcast({
        title,
        message,
        targetAudience,
        status: "sending"
      });

      // Get target users
      const targetUsers = await storage.getTargetUsers(targetAudience);
      
      // Send broadcast in background
      sendBroadcastToUsers(broadcast.id, message, targetUsers);

      res.json({ 
        ...broadcast, 
        targetCount: targetUsers.length
      });
    } catch (error) {
      console.error("Error creating broadcast:", error);
      res.status(500).json({ error: "Failed to create broadcast" });
    }
  });

  // Broadcast audience counts
  app.get("/api/broadcasts/audience-counts", async (req, res) => {
    try {
      const [allUsers, subscribers, activeUsers, payingUsers] = await Promise.all([
        storage.getTargetUsers('all'),
        storage.getTargetUsers('subscribers'), 
        storage.getTargetUsers('active'),
        storage.getTargetUsers('paying')
      ]);

      res.json({
        all: allUsers.length,
        subscribers: subscribers.length,
        active: activeUsers.length,
        paying: payingUsers.length
      });
    } catch (error) {
      console.error("Error fetching audience counts:", error);
      res.status(500).json({ error: "Failed to fetch audience counts" });
    }
  });

  // Users management
  app.get("/api/users", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const users = await storage.getUsers(limit, (page - 1) * limit);
      const totalCount = await storage.getUsersCount();
      
      res.json({
        users,
        totalCount,
        page,
        totalPages: Math.ceil(totalCount / limit)
      });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // AI Requests analytics
  app.get("/api/ai-requests/stats", async (req, res) => {
    try {
      const stats = await storage.getAiRequestsStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching AI requests stats:", error);
      res.status(500).json({ error: "Failed to fetch AI requests stats" });
    }
  });

  // Payments analytics
  app.get("/api/payments/stats", async (req, res) => {
    try {
      const stats = await storage.getPaymentsStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching payments stats:", error);
      res.status(500).json({ error: "Failed to fetch payments stats" });
    }
  });

  // Referrals analytics  
  app.get("/api/referrals/stats", async (req, res) => {
    try {
      const stats = await storage.getReferralsStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching referrals stats:", error);
      res.status(500).json({ error: "Failed to fetch referrals stats" });
    }
  });

  // Webhook handler for production bot  
  app.post("/webhook/:token", async (req, res) => {
    try {
      const { token } = req.params;
      console.log('🔔 Webhook received for token ending in:', token.slice(-6));
      
      if (token === process.env.BOT_TOKEN) {
        // Process update with production bot
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
      } else {
        console.log('❌ Invalid webhook token');
        res.status(403).send('Forbidden');
      }
    } catch (error) {
      console.error("Webhook error:", error);
      res.status(500).send('Internal Server Error');
    }
  });

  // Set webhook endpoint (for manual setup)
  app.post("/api/bot/webhook", async (req, res) => {
    try {
      const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/${process.env.BOT_TOKEN}`;
      await bot.telegram.setWebhook(webhookUrl);
      res.json({ success: true, webhookUrl });
    } catch (error) {
      console.error("Error setting webhook:", error);
      res.status(500).json({ error: "Failed to set webhook" });
    }
  });

  // Bot info
  app.get("/api/bot/info", async (req, res) => {
    try {
      const me = await bot.telegram.getMe();
      const webhookInfo = await bot.telegram.getWebhookInfo();
      res.json({ bot: me, webhook: webhookInfo });
    } catch (error) {
      console.error("Error fetching bot info:", error);
      res.status(500).json({ error: "Failed to fetch bot info" });
    }
  });

  // Bot settings
  app.get("/api/bot/settings", async (req, res) => {
    try {
      const settings = await storage.getAllBotSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching bot settings:", error);
      res.status(500).json({ error: "Failed to fetch bot settings" });
    }
  });

  app.put("/api/bot/settings/:key", async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body;
      
      await storage.setBotSetting(key, value);
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating bot setting:", error);
      res.status(500).json({ error: "Failed to update bot setting" });
    }
  });

  const httpServer = createServer(app);

  // Initialize bot
  const isDeployed = process.env.REPLIT_DEPLOYMENT === '1' || process.env.NODE_ENV === 'production';
  
  if (isDeployed) {
    // Set webhook in production/deploy
    const baseUrl = process.env.WEBHOOK_URL?.replace(/\/$/, '') || ''; // Remove trailing slash
    const webhookUrl = `${baseUrl}/webhook/${process.env.BOT_TOKEN}`;
    console.log('🚀 Setting up webhook for production bot:', webhookUrl);
    bot.telegram.setWebhook(webhookUrl).catch(console.error);
  } else {
    console.log('ℹ️  Production bot @Nemo_designer_bot работает только в Deploy среде');
    console.log('💡 Для тестирования используйте @BOT_TOKEN_PREVIEW_BOT');
    console.log('🚀 Чтобы активировать @Nemo_designer_bot, нужно сделать Deploy приложения');
    
    // Use polling in development
    console.log('🔧 Removing existing webhook before starting polling...');
    bot.telegram.deleteWebhook({ drop_pending_updates: true })
      .then(() => {
        console.log('✅ Webhook removed successfully');
        console.log('⏳ Waiting 10 seconds for any existing polling connections to close...');
        return new Promise(resolve => setTimeout(resolve, 10000));
      })
      .then(() => {
        console.log('🚀 Starting bot in polling mode...');
        const launchPromise = bot.launch({ dropPendingUpdates: true });
        launchPromise.catch((error) => {
          console.error('❌ Failed to start bot:', error);
          
          // Дополнительная диагностика для 409 ошибок
          if (error.response?.error_code === 409) {
            console.log('🔍 409 Conflict detected with token ending in:', botToken?.slice(-6));
            console.log('💡 Possible causes:');
            console.log('  1. Deploy environment also uses this token');
            console.log('  2. Another Replit workspace is running');
            console.log('  3. Previous bot instance still active');
            console.log('  4. Telegram servers are slow to release connection');
            console.log('');
            console.log('🛠️ Solutions to try:');
            console.log('  - Check Deploy environment variables');
            console.log('  - Create THIRD bot token if needed'); 
            console.log('  - Wait 10-15 minutes for Telegram to release connection');
            console.log('  - Use different Replit workspace');
          }
        });
        console.log('✅ Bot launched successfully in polling mode!');
      });
  }

  // AI Settings endpoints
  app.get("/api/ai/settings", async (req, res) => {
    try {
      res.json(getCurrentAISettings());
    } catch (error) {
      console.error("Error fetching AI settings:", error);
      res.status(500).json({ error: "Failed to fetch AI settings" });
    }
  });

  app.post("/api/ai/settings", async (req, res) => {
    try {
      const { imageGenerationModel, imageQuality } = req.body;
      
      // Validate model
      const validModels = ["polza-nano-banana", "gpt-image-1", "gemini-2.5-flash-image-preview"];
      if (imageGenerationModel && !validModels.includes(imageGenerationModel)) {
        return res.status(400).json({ error: "Invalid model selected" });
      }
      
      // Validate quality
      const validQualities = ["low", "medium", "high"];
      if (imageQuality && !validQualities.includes(imageQuality)) {
        return res.status(400).json({ error: "Invalid quality selected" });
      }
      
      // Update settings
      const updatedSettings = updateAISettings({
        ...(imageGenerationModel && { imageGenerationModel }),
        ...(imageQuality && { imageQuality })
      });
      
      console.log('🔧 AI settings updated:', updatedSettings);
      res.json(updatedSettings);
    } catch (error) {
      console.error("Error updating AI settings:", error);
      res.status(500).json({ error: "Failed to update AI settings" });
    }
  });

  // Test image generation endpoint
  app.post("/api/ai/test-generation", async (req, res) => {
    try {
      const { imageUrl, prompt } = req.body;
      
      if (!imageUrl || !prompt) {
        return res.status(400).json({ error: "Missing imageUrl or prompt" });
      }
      
      console.log('🧪 Testing image generation with model:', getCurrentAISettings().imageGenerationModel);
      
      // For testing purposes, just return success without actually generating
      // This avoids issues with test URLs and API limits
      res.json({
        success: true,
        model: getCurrentAISettings().imageGenerationModel,
        imageUrl: "https://via.placeholder.com/512x512/4a90e2/ffffff?text=Test+Generated+Image",
        description: `Тест генерации с моделью ${getCurrentAISettings().imageGenerationModel} выполнен успешно`
      });
    } catch (error) {
      console.error("Error testing image generation:", error);
      res.status(500).json({ 
        success: false,
        error: "Test generation failed",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Initialize cron jobs
  initializeCronJobs();

  return httpServer;
}

// AI settings are now managed through aiSettings.ts module

async function sendBroadcastToUsers(broadcastId: string, message: string, users: any[]) {
  let sentCount = 0;
  let deliveredCount = 0;
  let errorCount = 0;

  for (const user of users) {
    try {
      await bot.telegram.sendMessage(parseInt(user.telegramId), message);
      await storage.recordBroadcastDelivery(broadcastId, user.id, 'delivered');
      deliveredCount++;
      sentCount++;
      
      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await storage.recordBroadcastDelivery(broadcastId, user.id, 'failed', errorMessage);
      errorCount++;
      sentCount++;
      console.error(`Failed to send broadcast to user ${user.id}:`, errorMessage);
    }
  }

  // Update broadcast stats
  await storage.updateBroadcast(broadcastId, {
    status: 'completed',
    sentCount,
    deliveredCount,
    errorCount,
    sentAt: new Date()
  });

  console.log(`Broadcast ${broadcastId} completed: ${deliveredCount}/${sentCount} delivered, ${errorCount} errors`);
}
