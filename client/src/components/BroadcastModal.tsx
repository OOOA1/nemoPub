import { useState } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { X } from "lucide-react";

interface BroadcastModalProps {
  open: boolean;
  onClose: () => void;
}

interface AudienceCounts {
  all: number;
  subscribers: number;
  active: number;
  paying: number;
}

export default function BroadcastModal({ open, onClose }: BroadcastModalProps) {
  const [formData, setFormData] = useState({
    title: "",
    message: "",
    targetAudience: "all",
    sendNow: true,
    trackClicks: false,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: audienceCounts } = useQuery<AudienceCounts>({
    queryKey: ["/api/broadcasts/audience-counts"],
    enabled: open,
  });

  const createBroadcastMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest("POST", "/api/broadcasts", {
        title: data.title,
        message: data.message,
        targetAudience: data.targetAudience,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Рассылка создана",
        description: "Сообщения отправляются пользователям",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/broadcasts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      onClose();
      setFormData({
        title: "",
        message: "",
        targetAudience: "all",
        sendNow: true,
        trackClicks: false,
      });
    },
    onError: (error) => {
      toast({
        title: "Ошибка",
        description: "Не удалось создать рассылку",
        variant: "destructive",
      });
      console.error("Error creating broadcast:", error);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title.trim() || !formData.message.trim()) {
      toast({
        title: "Ошибка",
        description: "Заполните все обязательные поля",
        variant: "destructive",
      });
      return;
    }

    createBroadcastMutation.mutate(formData);
  };

  const getAudienceCount = (audience: string) => {
    if (!audienceCounts) return 0;
    switch (audience) {
      case 'subscribers':
        return audienceCounts.subscribers;
      case 'active':
        return audienceCounts.active;
      case 'paying':
        return audienceCounts.paying;
      default:
        return audienceCounts.all;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="modal-broadcast">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold text-foreground">Создать рассылку</DialogTitle>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClose}
              data-testid="button-close-modal"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <Label htmlFor="title" className="block text-sm font-medium text-foreground mb-2">
              Заголовок рассылки
            </Label>
            <Input
              id="title"
              type="text"
              placeholder="Введите заголовок"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
              data-testid="input-broadcast-title"
            />
          </div>
          
          <div>
            <Label htmlFor="message" className="block text-sm font-medium text-foreground mb-2">
              Сообщение
            </Label>
            <Textarea
              id="message"
              rows={4}
              placeholder="Текст сообщения..."
              value={formData.message}
              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
              required
              data-testid="textarea-broadcast-message"
            />
          </div>
          
          <div>
            <Label className="block text-sm font-medium text-foreground mb-2">
              Аудитория
            </Label>
            <Select 
              value={formData.targetAudience} 
              onValueChange={(value) => setFormData({ ...formData, targetAudience: value })}
            >
              <SelectTrigger data-testid="select-broadcast-audience">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  Все пользователи ({getAudienceCount('all')})
                </SelectItem>
                <SelectItem value="subscribers">
                  Только подписчики ({getAudienceCount('subscribers')})
                </SelectItem>
                <SelectItem value="active">
                  Активные пользователи ({getAudienceCount('active')})
                </SelectItem>
                <SelectItem value="paying">
                  Платящие пользователи ({getAudienceCount('paying')})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="sendNow"
                checked={formData.sendNow}
                onCheckedChange={(checked) => setFormData({ ...formData, sendNow: !!checked })}
                data-testid="checkbox-send-now"
              />
              <Label htmlFor="sendNow" className="text-sm text-foreground">
                Отправить сейчас
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="trackClicks"
                checked={formData.trackClicks}
                onCheckedChange={(checked) => setFormData({ ...formData, trackClicks: !!checked })}
                data-testid="checkbox-track-clicks"
              />
              <Label htmlFor="trackClicks" className="text-sm text-foreground">
                Отслеживать переходы
              </Label>
            </div>
          </div>
          
          <div className="flex justify-end space-x-3 pt-4 border-t border-border">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onClose}
              data-testid="button-cancel-broadcast"
            >
              Отмена
            </Button>
            <Button 
              type="submit" 
              disabled={createBroadcastMutation.isPending}
              data-testid="button-submit-broadcast"
            >
              {createBroadcastMutation.isPending ? "Создание..." : "Создать рассылку"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
