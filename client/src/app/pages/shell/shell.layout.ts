import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../core/auth.service';
import { Icon, type IconName } from '../../shared/icon';
import { Logo } from '../../shared/logo';

interface NavItem {
  label: string;
  icon: IconName;
  link: string;
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Logo],
  templateUrl: './shell.layout.html',
  styleUrl: './shell.layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closeMenus()' },
})
export class ShellLayout {
  protected readonly auth = inject(AuthService);

  protected readonly sidebarOpen = signal(false);
  protected readonly userMenuOpen = signal(false);

  protected readonly initials = computed(() =>
    (this.auth.user()?.name ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join(''),
  );

  protected readonly mainNav: NavItem[] = [
    { label: 'Início', icon: 'home', link: '/app' },
    { label: 'Estatísticas', icon: 'chart', link: '/app/estatisticas' },
    { label: 'Assuntos', icon: 'layers', link: '/app/assuntos' },
    { label: 'Perfil', icon: 'user', link: '/app/perfil' },
  ];

  protected readonly generalNav: NavItem[] = [
    { label: 'Configurações', icon: 'settings', link: '/app/configuracoes' },
    { label: 'Ajuda', icon: 'help', link: '/app/ajuda' },
  ];

  constructor() {
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.closeMenus());
  }

  protected closeMenus() {
    this.sidebarOpen.set(false);
    this.userMenuOpen.set(false);
  }
}
