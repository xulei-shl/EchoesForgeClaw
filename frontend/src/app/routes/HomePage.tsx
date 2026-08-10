import React from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../../platform/components/layout/Navbar';
import { Button } from '../../platform/components/ui/Button';
import { useAuth } from '../../platform/stores/authStore';
import { getStartCreationRoute } from '../../platform/utils/creation';

const HomePage: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-paper flex flex-col relative">
      {/* 纸张网格背景装饰 */}
      <div className="absolute inset-0 pointer-events-none grid-paper opacity-30">
      </div>
      
      <div className="relative z-10 flex flex-col flex-grow">
        <Navbar />
        
        <main className="flex-grow flex flex-col items-center justify-center p-6 text-center max-w-4xl mx-auto">
          <div className="bg-node-bg p-12 rounded-lg border-2 border-dashed border-paper-grid relative shadow-sm">
            {/* 角落装饰 */}
            <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-accent"></div>
            <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-accent"></div>
            <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-accent"></div>
            <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-accent"></div>
            
            <h1 className="text-5xl font-serif font-bold text-ink mb-6">
              Welcome to <span className="text-accent">BookForge</span>
            </h1>
            
            <p className="text-lg text-ink-light font-sans mb-10 max-w-2xl leading-relaxed">
             书海回响（书目推荐）阅读推广素材生成平台。在这里，我们用文字铸造知识的轮廓，用线描勾勒阅读的温度。
            </p>
            
            <div className="flex gap-4 justify-center">
              <Link to={user ? getStartCreationRoute() : '/login'}>
                <Button size="lg" className="font-sans">
                  开始创作
                </Button>
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default HomePage;
