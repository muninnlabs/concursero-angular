import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./pages/landing/landing.page').then((m) => m.LandingPage) },
  { path: 'entrar', canActivate: [guestGuard], loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage) },
  { path: 'app/ajuda', redirectTo: 'ajuda' },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/shell/shell.layout').then((m) => m.ShellLayout),
    children: [
      { path: '', pathMatch: 'full', title: 'Início · Concursero', loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'praticar', title: 'Praticar · Concursero', loadComponent: () => import('./pages/practice/practice.page').then((m) => m.PracticePage) },
      {
        path: 'assuntos',
        title: 'Assuntos · Concursero',
        data: { search: 'Buscar assuntos...' },
        loadComponent: () => import('./pages/subjects/subjects.page').then((m) => m.SubjectsPage),
      },
      {
        path: 'estatisticas',
        title: 'Estatísticas · Concursero',
        data: { search: 'Buscar matérias...' },
        loadComponent: () => import('./pages/stats/stats.page').then((m) => m.StatsPage),
      },
      {
        path: 'configuracoes',
        title: 'Configurações · Concursero',
        data: { topbarTitle: 'Configurações do sistema' },
        loadComponent: () => import('./pages/settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        path: 'admin',
        title: 'Painel · Concursero',
        canActivate: [adminGuard],
        data: { topbarTitle: 'Painel administrativo' },
        loadComponent: () => import('./pages/admin/admin.page').then((m) => m.AdminPage),
      },
      {
        path: 'perfil',
        title: 'Perfil · Concursero',
        data: { topbarTitle: 'Seu perfil de estudante' },
        loadComponent: () => import('./pages/profile/profile.page').then((m) => m.ProfilePage),
      },
    ],
  },
  {
    path: '',
    loadComponent: () => import('./pages/info/info.layout').then((m) => m.InfoLayout),
    children: [
      { path: 'ajuda', title: 'Ajuda · Concursero', loadComponent: () => import('./pages/info/ajuda.page').then((m) => m.AjudaPage) },
      { path: 'sobre', title: 'Sobre nós · Concursero', loadComponent: () => import('./pages/info/sobre.page').then((m) => m.SobrePage) },
      { path: 'contato', title: 'Contato · Concursero', loadComponent: () => import('./pages/info/contato.page').then((m) => m.ContatoPage) },
      {
        path: 'privacidade',
        title: 'Política de Privacidade · Concursero',
        loadComponent: () => import('./pages/info/privacidade.page').then((m) => m.PrivacidadePage),
      },
      { path: 'termos', title: 'Termos de Uso · Concursero', loadComponent: () => import('./pages/info/termos.page').then((m) => m.TermosPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
