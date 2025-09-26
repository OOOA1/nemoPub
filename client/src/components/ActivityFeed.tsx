import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, Palette, CreditCard } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface Activity {
  id: string;
  type: string;
  user: string;
  action: string;
  time: Date;
}

interface ActivityFeedProps {
  activity: Activity[];
  isLoading?: boolean;
}

export default function ActivityFeed({ activity, isLoading }: ActivityFeedProps) {
  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'inspection':
        return { icon: User, bg: 'bg-primary', color: 'text-primary-foreground' };
      case 'design':
        return { icon: Palette, bg: 'bg-secondary', color: 'text-secondary-foreground' };
      case 'payment':
        return { icon: CreditCard, bg: 'bg-green-500', color: 'text-white' };
      default:
        return { icon: User, bg: 'bg-gray-500', color: 'text-white' };
    }
  };

  const formatTime = (time: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(time).getTime();
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return 'сейчас';
    if (minutes < 60) return `${minutes} мин назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч назад`;
    const days = Math.floor(hours / 24);
    return `${days} д назад`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Активность пользователей</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center space-x-3 p-3 bg-accent rounded-lg">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-20 mb-1" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Активность пользователей</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activity.length > 0 ? (
            activity.map((item) => {
              const { icon: Icon, bg, color } = getActivityIcon(item.type);
              return (
                <div 
                  key={item.id} 
                  className="flex items-center space-x-3 p-3 bg-accent rounded-lg"
                  data-testid={`activity-item-${item.id}`}
                >
                  <div className={`w-8 h-8 ${bg} rounded-full flex items-center justify-center`}>
                    <Icon className={`h-4 w-4 ${color}`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground" data-testid={`activity-user-${item.id}`}>
                      {item.user}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid={`activity-action-${item.id}`}>
                      {item.action}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground" data-testid={`activity-time-${item.id}`}>
                    {formatTime(item.time)}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="text-center text-muted-foreground py-4">
              Нет активности
            </div>
          )}
        </div>
        <Button 
          variant="ghost" 
          className="w-full mt-4 text-primary hover:text-primary/80"
          data-testid="button-view-all-activity"
        >
          Показать всю активность
        </Button>
      </CardContent>
    </Card>
  );
}
