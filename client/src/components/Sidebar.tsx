import { cn } from "@/lib/utils";
import { Construction, BarChart3, Users, ToyBrick, Car, CreditCard, Share, Settings } from "lucide-react";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const sidebarItems = [
  { id: "dashboard", label: "Обзор", icon: BarChart3 },
  { id: "users", label: "Пользователи", icon: Users },
  { id: "ai", label: "ИИ Агенты", icon: ToyBrick },
  { id: "broadcasts", label: "Рассылки", icon: Car },
  { id: "payments", label: "Платежи", icon: CreditCard },
  { id: "referrals", label: "Рефералы", icon: Share },
  { id: "settings", label: "Настройки", icon: Settings },
];

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <div className="w-64 bg-card shadow-lg border-r border-border">
      <div className="p-6 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
            <Construction className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">NEMO Moscow</h1>
            <p className="text-sm text-muted-foreground">Bot Admin</p>
          </div>
        </div>
      </div>
      
      <nav className="mt-6">
        <div className="px-3">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className={cn(
                  "sidebar-item flex items-center px-3 py-2 rounded-md cursor-pointer mb-1",
                  activeTab === item.id && "active"
                )}
                onClick={() => onTabChange(item.id)}
                data-testid={`sidebar-item-${item.id}`}
              >
                <Icon className="mr-3 h-5 w-5" />
                <span className="font-medium">{item.label}</span>
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
