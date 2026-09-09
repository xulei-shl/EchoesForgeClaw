import React from 'react';
import { Pencil } from 'lucide-react';
import { motion } from 'framer-motion';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import 'react-photo-view/dist/react-photo-view.css';
import { Tooltip } from '../../../../../shared/components/ui/Tooltip';

interface StampResultPreviewProps {
  imageUrl: string | null;
  onEditAgain: () => void;
}

export const StampResultPreview: React.FC<StampResultPreviewProps> = ({
  imageUrl,
  onEditAgain,
}) => {
  return (
    <motion.div
      key="preview"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className="relative w-full h-full flex items-center justify-center p-2 group"
    >
      {imageUrl ? (
        <div className="relative max-w-full max-h-full flex items-center justify-center">
          <PhotoProvider maskOpacity={0.8} bannerVisible={false}>
            <PhotoView src={imageUrl}>
              <Tooltip content="点击全屏查看">
                <img
                  src={imageUrl}
                  alt="Stamp Generated"
                  className="max-w-full max-h-[420px] object-contain rounded drop-shadow-xl select-none cursor-zoom-in group-hover:opacity-95 active:scale-[0.98] transition-[transform,opacity] duration-150"
                  loading="lazy"
                />
              </Tooltip>
            </PhotoView>
          </PhotoProvider>

          {/* 快捷悬浮重新编辑按钮 */}
          <button
            type="button"
            onClick={onEditAgain}
            className="absolute bottom-3 right-3 z-10 px-2.5 py-1 rounded-full bg-paper/90 backdrop-blur text-ink text-xs shadow-md border border-paper-grid/40 hover:bg-white hover:text-accent active:scale-[0.96] transition-[transform,color,background-color,opacity] flex items-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-90 duration-150 cursor-pointer select-none"
          >
            <Pencil size={12} />
            <span>重新排版</span>
          </button>
        </div>
      ) : (
        <div className="text-xs text-ink-faint">暂无邮票生成结果</div>
      )}
    </motion.div>
  );
};
