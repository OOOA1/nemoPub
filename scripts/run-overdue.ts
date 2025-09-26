import 'dotenv/config';
import { overdueNotifier } from '../server/notifiers/overdueNotifier';

(async () => {
  try {
    await overdueNotifier();
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
