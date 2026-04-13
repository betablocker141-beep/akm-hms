import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

export function Layout() {
  const { sidebarCollapsed, mobileSidebarOpen, closeMobileSidebar } = useUIStore()

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile overlay backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={closeMobileSidebar}
        />
      )}

      <Sidebar />

      <div
        className={cn(
          'flex flex-col transition-all duration-300',
          // Mobile: no left margin (sidebar is an overlay)
          'ml-0',
          // Desktop: margin matches sidebar width
          sidebarCollapsed ? 'md:ml-16' : 'md:ml-60'
        )}
      >
        <TopBar />
        <main className="flex-1 p-3 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
