import React from 'react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import { Layers } from 'lucide-react';

interface SelectedItemBarProps {
  imageUrl: string;
  name: string;
  hasDownstream: boolean;
}

export const SelectedItemBar = React.memo(({ imageUrl, name, hasDownstream }: SelectedItemBarProps) => {
  if (!imageUrl) return null;
  return (
    <div className="flex items-center gap-2 p-2 mt-2 rounded-lg bg-paper-grid/20 border border-paper-grid">
      <PhotoProvider><PhotoView src={imageUrl}>
        <img src={imageUrl} alt={name} className="w-12 h-12 object-cover rounded-md cursor-pointer" />
      </PhotoView></PhotoProvider>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-ink truncate">{name}</p>
      </div>
      {hasDownstream && <Layers size={14} className="text-ink-faint shrink-0" />}
    </div>
  );
});