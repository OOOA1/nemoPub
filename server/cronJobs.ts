import cron from 'node-cron';
import { storage } from './storage';
import { overdueNotifier } from './notifiers/overdueNotifier';

export function initializeCronJobs() {
  // Reset weekly limits every Monday at 00:00
  cron.schedule('0 0 * * 1', async () => {
    try {
      console.log('Running weekly limits reset...');
      
      // Reset all users' weekly request counts
      await storage.resetWeeklyLimits();
      
      console.log('Weekly limits reset completed');
    } catch (error) {
      console.error('Error resetting weekly limits:', error);
    }
  }, {
    timezone: "Europe/Moscow"
  });

  // Check subscription statuses every hour (temporarily disabled)
  // cron.schedule('0 * * * *', async () => {
  //   try {
  //     console.log('Running subscription status check...');
  //     
  //     // Get all active users and verify their subscription status
  //     const activeUsers = await storage.getActiveUsers();
  //     
  //     for (const user of activeUsers) {
  //       // This would normally check against Telegram API
  //       // For now, we'll implement a placeholder that maintains current status
  //       await storage.updateUserSubscription(user.id, user.isSubscribed);
  //     }
  //     
  //     console.log(`Checked ${activeUsers.length} user subscriptions`);
  //   } catch (error) {
  //     console.error('Error checking subscriptions:', error);
  //   }
  // });

  // Cleanup old data monthly
  cron.schedule('0 0 1 * *', async () => {
    try {
      console.log('Running monthly cleanup...');
      
      // Clean up old AI requests (older than 6 months)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      await storage.cleanupOldData(sixMonthsAgo);
      
      console.log('Monthly cleanup completed');
    } catch (error) {
      console.error('Error during monthly cleanup:', error);
    }
  });

  // Check overdue defects every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await overdueNotifier();
    } catch (error) {
      console.error('❌ Overdue notifier failed', error);
    }
  });

  console.log('Cron jobs initialized');
}
