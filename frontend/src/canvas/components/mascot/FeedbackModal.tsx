import React, { useState, useEffect } from 'react';
import { Send, MessageSquareHeart } from 'lucide-react';
import { Dialog } from '../../../shared/components/ui/Dialog';
import { Button } from '../../../shared/components/ui/Button';
import { Input } from '../../../shared/components/ui/Input';
import { Textarea } from '../../../shared/components/ui/Textarea';
import { useFeedback } from '../../../shared/components/ui/FeedbackProvider';
import api from '../../../shared/services/api';

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  mascotName?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ open, onClose, mascotName }) => {
  const { showToast } = useFeedback();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [content, setContent] = useState('');

  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [contentError, setContentError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 弹窗打开时，若有已登录用户，预填用户名
  useEffect(() => {
    if (open) {
      try {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          const user = JSON.parse(storedUser);
          if (user?.username && !name) {
            setName(user.username);
          }
        }
      } catch {
        /* ignore parse error */
      }
    }
  }, [open]);

  const validate = (): boolean => {
    let valid = true;
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const cleanContent = content.trim();

    if (!cleanName) {
      setNameError('请填写您的姓名或昵称');
      valid = false;
    } else {
      setNameError('');
    }

    if (!cleanEmail) {
      setEmailError('请填写联系邮箱');
      valid = false;
    } else if (!EMAIL_REGEX.test(cleanEmail)) {
      setEmailError('邮箱格式不正确，如 user@example.com');
      valid = false;
    } else {
      setEmailError('');
    }

    if (!cleanContent) {
      setContentError('请填写您的反馈内容');
      valid = false;
    } else {
      setContentError('');
    }

    return valid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const res = (await api.post('/feedback', {
        name: name.trim(),
        email: email.trim(),
        content: content.trim(),
      })) as { success?: boolean; message?: string };

      showToast(res.message || '反馈已发送，感谢您的宝贵建议！', { type: 'success' });
      setContent('');
      onClose();
    } catch (err: any) {
      showToast(err?.detail || err?.message || '发送失败，请稍后重试', { type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!isSubmitting}
      panelClassName="max-w-md"
      title={
        <div className="flex items-center justify-between w-full pr-1">
          <div className="flex items-center gap-2 text-ink">
            <MessageSquareHeart size={20} className="text-accent" />
            <span className="font-serif font-bold text-base">画板意见与反馈</span>
          </div>
          {mascotName && (
            <span className="text-xs font-sans text-ink-faint px-2 py-0.5 rounded-full bg-paper-grid/20">
              {mascotName} 正在倾听
            </span>
          )}
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2.5 w-full">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            className="flex items-center gap-1.5"
          >
            <Send size={14} />
            发送反馈
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        <p className="text-xs text-ink-light font-sans leading-relaxed">
          欢迎提出您对画板体验、节点功能或排版工具的任何建议！反馈将直接推送至开发团队。
        </p>

        {/* 姓名（必填） */}
        <div>
          <Input
            label="姓名 / 昵称 *"
            placeholder="请输入您的姓名或昵称"
            value={name}
            error={nameError}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError('');
            }}
            disabled={isSubmitting}
            maxLength={60}
          />
        </div>

        {/* 邮箱（必填） */}
        <div>
          <Input
            label="联系邮箱 *"
            type="email"
            placeholder="用于向您同步反馈处理进展"
            value={email}
            error={emailError}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError('');
            }}
            disabled={isSubmitting}
            maxLength={120}
          />
        </div>

        {/* 反馈内容（必填） */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-sans text-ink-light">反馈详情 *</label>
            <span className="text-xs text-ink-faint font-sans tabular-nums">{content.length}/1000</span>
          </div>
          <Textarea
            placeholder="请详细描述您遇到的问题、改进设想或新功能诉求..."
            rows={4}
            value={content}
            error={!!contentError}
            onChange={(e) => {
              setContent(e.target.value);
              if (contentError) setContentError('');
            }}
            disabled={isSubmitting}
            maxLength={1000}
          />
          {contentError && <span className="text-xs text-error font-sans">{contentError}</span>}
        </div>
      </form>
    </Dialog>
  );
};
