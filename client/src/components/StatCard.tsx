import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface StatCardProps {
  title: string;
  value: string | number;
  growth: number;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  isLoading?: boolean;
  "data-testid"?: string;
}

export default function StatCard({ 
  title, 
  value, 
  growth, 
  icon: Icon, 
  iconColor, 
  iconBg, 
  isLoading,
  "data-testid": testId 
}: StatCardProps) {
  if (isLoading) {
    return (
      <Card className="stat-card">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <Skeleton className="h-4 w-32 mb-2" />
              <Skeleton className="h-8 w-20" />
            </div>
            <Skeleton className="h-12 w-12 rounded-full" />
          </div>
          <div className="flex items-center mt-4">
            <Skeleton className="h-4 w-12 mr-2" />
            <Skeleton className="h-4 w-16" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="stat-card cursor-pointer" data-testid={testId}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-muted-foreground text-sm font-medium">{title}</p>
            <p className="text-2xl font-bold text-foreground" data-testid={`${testId}-value`}>
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
          </div>
          <div className={`${iconBg} p-3 rounded-full`}>
            <Icon className={`h-6 w-6 ${iconColor}`} />
          </div>
        </div>
        <div className="flex items-center mt-4 text-sm">
          <span 
            className={`font-medium ${growth >= 0 ? 'text-green-600' : 'text-red-600'}`}
            data-testid={`${testId}-growth`}
          >
            {growth >= 0 ? '+' : ''}{growth.toFixed(1)}%
          </span>
          <span className="text-muted-foreground ml-2">за неделю</span>
        </div>
      </CardContent>
    </Card>
  );
}
