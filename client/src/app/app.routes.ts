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
      {
        path: 'assuntos',
        title: 'Assuntos · BrasilQuiz',
        data: { search: 'Buscar assuntos...' },
        loadComponent: () => import('./pages/subjects/subjects.page').then((m) => m.SubjectsPage),
      },
      {
        path: 'estatisticas',
        title: 'Estatísticas · BrasilQuiz',
        data: { search: 'Buscar matérias...' },
        loadComponent: () => import('./pages/stats/stats.page').then((m) => m.StatsPage),
      },
      {
        path: 'configuracoes',
        title: 'Configurações · BrasilQuiz',
        data: { topbarTitle: 'Configurações do sistema' },
        loadComponent: () => import('./pages/settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        path: 'perfil',
        title: 'Perfil · BrasilQuiz',
        data: { topbarTitle: 'Seu perfil de estudante' },
        loadComponent: () => import('./pages/profile/profile.page').then((m) => m.ProfilePage),
      },
      ...[
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
