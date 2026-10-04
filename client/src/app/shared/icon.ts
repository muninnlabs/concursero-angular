import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input } from '@angular/core';
import {
  ArrowLeft,
  ArrowRight,
  Atom,
  Award,
  Baby,
  Bell,
  BookOpen,
  Briefcase,
  Building2,
  Calculator,
  Camera,
  ChartLine,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Clock,
  Coins,
  Crown,
  ExternalLink,
  Feather,
  FileText,
  Flag,
  Flame,
  FlaskConical,
  Funnel,
  Gavel,
  Globe,
  GraduationCap,
  HeartHandshake,
  House,
  KeyRound,
  Landmark,
  Languages,
  Layers,
  Leaf,
  ListChecks,
  LogOut,
  MapPin,
  Menu,
  Moon,
  PenTool,
  Pencil,
  RotateCw,
  Scale,
  Search,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Sigma,
  Smartphone,
  Star,
  Target,
  Timer,
  Trash2,
  TriangleAlert,
  Trophy,
  User,
  Users,
  Volume2,
  Vote,
  X,
  Zap,
  type IconNode,
} from 'lucide';

// Brand marks were removed from Lucide, so these two are drawn by hand.
const Instagram: IconNode = [
  ['rect', { x: '2', y: '2', width: '20', height: '20', rx: '5' }],
  ['circle', { cx: '12', cy: '12', r: '4' }],
  ['line', { x1: '17.5', x2: '17.51', y1: '6.5', y2: '6.5' }],
];
const XLogo: IconNode = [['path', { d: 'M4 4l16 16M20 4 4 20', 'stroke-width': '2.2' }]];

/** Only the icons listed here end up in the bundle. */
const ICONS = {
  alert: TriangleAlert,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  atom: Atom,
  award: Award,
  baby: Baby,
  bell: Bell,
  'book-open': BookOpen,
  briefcase: Briefcase,
  building: Building2,
  calculator: Calculator,
  camera: Camera,
  chart: ChartLine,
  check: Check,
  'check-circle': CircleCheck,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  clock: Clock,
  coins: Coins,
  crown: Crown,
  'external-link': ExternalLink,
  feather: Feather,
  'file-text': FileText,
  filter: Funnel,
  flag: Flag,
  flame: Flame,
  flask: FlaskConical,
  gavel: Gavel,
  globe: Globe,
  'graduation-cap': GraduationCap,
  'heart-handshake': HeartHandshake,
  help: CircleHelp,
  home: House,
  instagram: Instagram,
  key: KeyRound,
  landmark: Landmark,
  languages: Languages,
  layers: Layers,
  leaf: Leaf,
  'list-checks': ListChecks,
  'log-out': LogOut,
  'map-pin': MapPin,
  menu: Menu,
  moon: Moon,
  'pen-tool': PenTool,
  pencil: Pencil,
  refresh: RotateCw,
  scale: Scale,
  search: Search,
  settings: Settings,
  share: Share2,
  shield: Shield,
  'shield-check': ShieldCheck,
  'shopping-cart': ShoppingCart,
  sigma: Sigma,
  smartphone: Smartphone,
  star: Star,
  target: Target,
  timer: Timer,
  trash: Trash2,
  trophy: Trophy,
  user: User,
  users: Users,
  volume: Volume2,
  vote: Vote,
  x: X,
  'x-logo': XLogo,
  zap: Zap,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

const SVG_NS = 'http://www.w3.org/2000/svg';

@Component({
  selector: 'app-icon',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', style: 'display:inline-flex;line-height:0' },
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  readonly strokeWidth = input(2);
  /** Fills the shapes with currentColor (used for solid badges like the star). */
  readonly filled = input(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    effect(() => {
      const svg = document.createElementNS(SVG_NS, 'svg');
      const attrs: Record<string, string> = {
        width: String(this.size()),
        height: String(this.size()),
        viewBox: '0 0 24 24',
        fill: this.filled() ? 'currentColor' : 'none',
        stroke: 'currentColor',
        'stroke-width': String(this.strokeWidth()),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      };
      for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, value);
      for (const [tag, shapeAttrs] of ICONS[this.name()]) {
        const el = document.createElementNS(SVG_NS, tag);
        for (const [key, value] of Object.entries(shapeAttrs)) el.setAttribute(key, String(value));
        svg.appendChild(el);
      }
      this.host.replaceChildren(svg);
    });
  }
}
