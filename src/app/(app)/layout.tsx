import { AppSidebar } from "@/components/AppSidebar";
import { MeProvider } from "@/components/MeProvider";
import { ToastProvider } from "@/components/Toast";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <MeProvider>
      <ToastProvider>
        <div className="flex min-h-dvh flex-col lg:flex-row">
          <AppSidebar />
          <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
        </div>
      </ToastProvider>
    </MeProvider>
  );
}
