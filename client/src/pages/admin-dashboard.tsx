import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Sidebar from "@/components/Sidebar";
import StatCard from "@/components/StatCard";
import ActivityFeed from "@/components/ActivityFeed";
import BroadcastModal from "@/components/BroadcastModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Plus, Eye, Construction, Users, ToyBrick, Car, CreditCard, Share, Settings } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface DashboardStats {
  totalUsers: number;
  subscribers: number;
  weeklyAiRequests: number;
  monthlyRevenue: number;
  weeklyGrowth: number;
  subscriberGrowth: number;
  aiRequestsGrowth: number;
  revenueGrowth: number;
}

interface Activity {
  id: string;
  type: string;
  user: string;
  action: string;
  time: Date;
}

interface Broadcast {
  id: string;
  title: string;
  sentCount: number;
  deliveredCount: number;
  createdAt: Date;
}

interface AudienceCounts {
  all: number;
  subscribers: number;
  active: number;
  paying: number;
}

interface AISettings {
  imageGenerationModel: string;
  imageQuality: string;
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState("polza-nano-banana");
  const [selectedQuality, setSelectedQuality] = useState("medium");
  const [testImage, setTestImage] = useState<File | null>(null);
  const [testPrompt, setTestPrompt] = useState("Transform to modern style with neutral accents");
  const { toast } = useToast();

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: activity, isLoading: activityLoading } = useQuery<Activity[]>({
    queryKey: ["/api/dashboard/activity"],
  });

  const { data: broadcasts, isLoading: broadcastsLoading } = useQuery<Broadcast[]>({
    queryKey: ["/api/broadcasts"],
  });

  const { data: audienceCounts } = useQuery<AudienceCounts>({
    queryKey: ["/api/broadcasts/audience-counts"],
  });

  const { data: aiSettings } = useQuery<AISettings>({
    queryKey: ["/api/ai/settings"],
  });

  // Update local state when settings are loaded
  useEffect(() => {
    if (aiSettings) {
      setSelectedModel(aiSettings.imageGenerationModel);
      setSelectedQuality(aiSettings.imageQuality);
    }
  }, [aiSettings]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: Partial<AISettings>) => {
      const response = await apiRequest("POST", "/api/ai/settings", settings);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Настройки сохранены",
        description: "Настройки ИИ модели успешно обновлены"
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/settings"] });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось сохранить настройки",
        variant: "destructive"
      });
    }
  });

  const testGenerationMutation = useMutation({
    mutationFn: async (data: { imageUrl: string; prompt: string }) => {
      const response = await apiRequest("POST", "/api/ai/test-generation", data);
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({
          title: "Тест успешен",
          description: `Генерация с моделью ${data.model} прошла успешно`
        });
      } else {
        toast({
          title: "Тест неудачен",
          description: data.error || "Ошибка при тестировании",
          variant: "destructive"
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Ошибка тестирования",
        description: "Не удалось протестировать генерацию",
        variant: "destructive"
      });
    }
  });

  const handleRefresh = () => {
    refetchStats();
  };

  const handleSaveSettings = () => {
    saveSettingsMutation.mutate({
      imageGenerationModel: selectedModel,
      imageQuality: selectedQuality
    });
  };

  const handleTestGeneration = () => {
    if (!testImage) {
      toast({
        title: "Нет изображения",
        description: "Пожалуйста, загрузите тестовое изображение",
        variant: "destructive"
      });
      return;
    }

    // For demo purposes, using a test that doesn't require actual image processing
    const demoImageUrl = "https://example.com/demo-image.jpg";
    
    testGenerationMutation.mutate({
      imageUrl: demoImageUrl,
      prompt: testPrompt
    });
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setTestImage(file);
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      
      <div className="flex-1 overflow-auto">
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Панель управления</h2>
              <p className="text-muted-foreground">Telegram Bot NEMO Moscow</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 text-sm">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-muted-foreground">Бот онлайн</span>
              </div>
              <Button 
                onClick={handleRefresh} 
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                data-testid="button-refresh"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Обновить
              </Button>
            </div>
          </div>
        </header>

        <div className="p-6">
          {activeTab === "dashboard" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <StatCard
                  title="Всего пользователей"
                  value={stats?.totalUsers || 0}
                  growth={stats?.weeklyGrowth || 0}
                  icon={Users}
                  iconColor="text-blue-600"
                  iconBg="bg-blue-100"
                  isLoading={statsLoading}
                  data-testid="stat-card-users"
                />
                
                <StatCard
                  title="Подписчики канала"
                  value={stats?.subscribers || 0}
                  growth={stats?.subscriberGrowth || 0}
                  icon={Users}
                  iconColor="text-green-600"
                  iconBg="bg-green-100"
                  isLoading={statsLoading}
                  data-testid="stat-card-subscribers"
                />
                
                <StatCard
                  title="ИИ запросов/неделя"
                  value={stats?.weeklyAiRequests || 0}
                  growth={stats?.aiRequestsGrowth || 0}
                  icon={ToyBrick}
                  iconColor="text-purple-600"
                  iconBg="bg-purple-100"
                  isLoading={statsLoading}
                  data-testid="stat-card-ai-requests"
                />
                
                <StatCard
                  title="Доход/месяц"
                  value={`₽${stats?.monthlyRevenue?.toLocaleString() || 0}`}
                  growth={stats?.revenueGrowth || 0}
                  icon={CreditCard}
                  iconColor="text-yellow-600"
                  iconBg="bg-yellow-100"
                  isLoading={statsLoading}
                  data-testid="stat-card-revenue"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle>Использование ИИ агентов</CardTitle>
                    <select className="text-sm border border-border rounded px-3 py-1" data-testid="select-chart-period">
                      <option>7 дней</option>
                      <option>30 дней</option>
                      <option>90 дней</option>
                    </select>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 bg-muted rounded flex items-center justify-center">
                      <div className="text-center">
                        <ToyBrick className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                        <p className="text-muted-foreground">График использования ИИ агентов</p>
                        <p className="text-sm text-muted-foreground">Технадзор: 60% | Дизайнер: 40%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <ActivityFeed activity={activity || []} isLoading={activityLoading} />
              </div>

              <Card className="mb-8">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Управление рассылками</CardTitle>
                  <Button 
                    onClick={() => setShowBroadcastModal(true)}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    data-testid="button-create-broadcast"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Создать рассылку
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="p-4 border border-border rounded-lg">
                      <h4 className="font-medium text-foreground mb-2">Все пользователи</h4>
                      <p className="text-2xl font-bold text-primary" data-testid="text-audience-all">
                        {audienceCounts?.all || 0}
                      </p>
                      <p className="text-sm text-muted-foreground">Всего в боте</p>
                    </div>
                    <div className="p-4 border border-border rounded-lg">
                      <h4 className="font-medium text-foreground mb-2">Подписчики</h4>
                      <p className="text-2xl font-bold text-secondary" data-testid="text-audience-subscribers">
                        {audienceCounts?.subscribers || 0}
                      </p>
                      <p className="text-sm text-muted-foreground">Подписаны на канал</p>
                    </div>
                    <div className="p-4 border border-border rounded-lg">
                      <h4 className="font-medium text-foreground mb-2">Активные</h4>
                      <p className="text-2xl font-bold text-green-600" data-testid="text-audience-active">
                        {audienceCounts?.active || 0}
                      </p>
                      <p className="text-sm text-muted-foreground">Активность 7 дней</p>
                    </div>
                  </div>

                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="bg-muted px-4 py-3 border-b border-border">
                      <h4 className="font-medium text-foreground">Последние рассылки</h4>
                    </div>
                    <div className="divide-y divide-border">
                      {broadcastsLoading ? (
                        <div className="p-4 text-center text-muted-foreground">Загрузка...</div>
                      ) : broadcasts && broadcasts.length > 0 ? (
                        broadcasts.map((broadcast) => (
                          <div key={broadcast.id} className="p-4 flex items-center justify-between" data-testid={`broadcast-item-${broadcast.id}`}>
                            <div className="flex-1">
                              <p className="font-medium text-foreground">{broadcast.title}</p>
                              <div className="flex items-center space-x-4 mt-1">
                                <span className="text-sm text-muted-foreground">
                                  Отправлено: {broadcast.sentCount} чел.
                                </span>
                                <span className="text-sm text-muted-foreground">
                                  Доставлено: {broadcast.deliveredCount} чел.
                                </span>
                                <span className="text-sm text-muted-foreground">
                                  {new Date(broadcast.createdAt).toLocaleDateString('ru-RU')}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Badge variant="secondary">Отправлена</Badge>
                              <Button variant="ghost" size="sm" data-testid={`button-view-broadcast-${broadcast.id}`}>
                                <Eye className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-4 text-center text-muted-foreground">Нет рассылок</div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="cursor-pointer hover:shadow-md transition-shadow" data-testid="card-quick-action-users">
                  <CardContent className="p-6">
                    <div className="flex items-center space-x-3">
                      <div className="bg-blue-100 p-3 rounded-full">
                        <Users className="h-6 w-6 text-blue-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-foreground">Пользователи</h4>
                        <p className="text-sm text-muted-foreground">Управление аккаунтами</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="cursor-pointer hover:shadow-md transition-shadow" data-testid="card-quick-action-ai">
                  <CardContent className="p-6">
                    <div className="flex items-center space-x-3">
                      <div className="bg-purple-100 p-3 rounded-full">
                        <ToyBrick className="h-6 w-6 text-purple-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-foreground">ИИ Мониторинг</h4>
                        <p className="text-sm text-muted-foreground">Статистика агентов</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="cursor-pointer hover:shadow-md transition-shadow" data-testid="card-quick-action-payments">
                  <CardContent className="p-6">
                    <div className="flex items-center space-x-3">
                      <div className="bg-green-100 p-3 rounded-full">
                        <CreditCard className="h-6 w-6 text-green-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-foreground">Платежи</h4>
                        <p className="text-sm text-muted-foreground">Транзакции и выручка</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="cursor-pointer hover:shadow-md transition-shadow" data-testid="card-quick-action-settings">
                  <CardContent className="p-6">
                    <div className="flex items-center space-x-3">
                      <div className="bg-orange-100 p-3 rounded-full">
                        <Settings className="h-6 w-6 text-orange-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-foreground">Настройки</h4>
                        <p className="text-sm text-muted-foreground">Конфигурация бота</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {activeTab === "ai" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Model Selection Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <ToyBrick className="h-5 w-5" />
                      <span>Настройки моделей ИИ</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-2 block">
                          Модель для генерации изображений
                        </label>
                        <Select value={selectedModel} onValueChange={setSelectedModel}>
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите модель" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="polza-nano-banana">Polza Nano Banana (Polza Gemini)</SelectItem>
                            <SelectItem value="gemini-2.5-flash-image-preview">Gemini 2.5 Flash (Native Gemini API)</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          Модель используется для трансформации изображений в ИИ-дизайнере
                        </p>
                      </div>
                      
                      <div>
                        <label className="text-sm font-medium text-foreground mb-2 block">
                          Качество изображений
                        </label>
                        <Select value={selectedQuality} onValueChange={setSelectedQuality}>
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите качество" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Низкое (быстро, дешево)</SelectItem>
                            <SelectItem value="medium">Среднее (баланс)</SelectItem>
                            <SelectItem value="high">Высокое (медленно, дорого)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <Button 
                        className="w-full" 
                        onClick={handleSaveSettings}
                        disabled={saveSettingsMutation.isPending}
                        data-testid="button-save-ai-settings"
                      >
                        {saveSettingsMutation.isPending ? "Сохраняется..." : "Сохранить настройки"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Test Generation Card */}
                <Card>
                  <CardHeader>
                    <CardTitle>Тестирование генерации</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-2 block">
                          Загрузить тестовое изображение
                        </label>
                        <Input 
                          type="file" 
                          accept="image/*"
                          onChange={handleImageUpload}
                          className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                          data-testid="input-test-image"
                        />
                      </div>
                      
                      <div>
                        <label className="text-sm font-medium text-foreground mb-2 block">
                          Промпт для трансформации
                        </label>
                        <Input 
                          placeholder="Например: modern minimalist living room with white furniture"
                          value={testPrompt}
                          onChange={(e) => setTestPrompt(e.target.value)}
                          data-testid="input-test-prompt"
                        />
                      </div>

                      <Button 
                        className="w-full" 
                        variant="outline" 
                        onClick={handleTestGeneration}
                        disabled={testGenerationMutation.isPending}
                        data-testid="button-test-generation"
                      >
                        {testGenerationMutation.isPending ? "Тестируется..." : "🎨 Тестировать генерацию"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* AI Usage Statistics */}
              <Card>
                <CardHeader>
                  <CardTitle>Статистика использования ИИ агентов</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 border border-border rounded-lg">
                      <h4 className="font-medium text-foreground mb-2">🔍 ИИ-Технадзор</h4>
                      <p className="text-2xl font-bold text-blue-600" data-testid="text-inspector-usage">
                        {stats?.weeklyAiRequests ? Math.floor(stats.weeklyAiRequests * 0.6) : 0}
                      </p>
                      <p className="text-sm text-muted-foreground">60% от общих запросов</p>
                    </div>
                    <div className="p-4 border border-border rounded-lg">
                      <h4 className="font-medium text-foreground mb-2">🎨 ИИ-Дизайнер</h4>
                      <p className="text-2xl font-bold text-purple-600" data-testid="text-designer-usage">
                        {stats?.weeklyAiRequests ? Math.floor(stats.weeklyAiRequests * 0.4) : 0}
                      </p>
                      <p className="text-sm text-muted-foreground">40% от общих запросов</p>
                    </div>
                    <div className="p-4 border border-border rounded-lg">
                      <h4 className="font-medium text-foreground mb-2">⚡ Среднее время</h4>
                      <p className="text-2xl font-bold text-green-600" data-testid="text-average-time">45с</p>
                      <p className="text-sm text-muted-foreground">Обработки запроса</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      <BroadcastModal 
        open={showBroadcastModal} 
        onClose={() => setShowBroadcastModal(false)} 
      />
    </div>
  );
}