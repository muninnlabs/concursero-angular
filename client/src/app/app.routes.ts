import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./pages/landing/landing.page').then((m) => m.LandingPage) },
  { path: 'entrar', canActivate: [guestGuard], loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage) },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/shell/shell.layout').then((m) => m.ShellLayout),
    children: [
      { path: '', pathMatch: 'full', title: 'Início · BrasilQuiz', loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'praticar', title: 'Praticar · BrasilQuiz', loadComponent: () => import('./pages/practice/practice.page').then((m) => m.PracticePage) },
      ...[
        { path: 'estatisticas', title: 'Estatísticas' },
        { path: 'assuntos', title: 'Assuntos' },
        { path: 'perfil', title: 'Perfil' },
        { path: 'configuracoes', title: 'Configurações' },
        { path: 'ajuda', title: 'Ajuda' },
      ].map(({ path, title }) => ({
        path,
        title: `${title} · BrasilQuiz`,
        data: { heading: title },
        loadComponent: () => import('./pages/placeholder/placeholder.page').then((m) => m.PlaceholderPage),
      })),
    ],
  },
  { path: '**', redirectTo: '' },
];
