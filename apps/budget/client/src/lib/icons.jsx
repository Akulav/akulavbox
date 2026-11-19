import {
  Baby,
  Bike,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  CircleEllipsis,
  Coffee,
  Dog,
  Dumbbell,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandCoins,
  Heart,
  HeartPulse,
  Home,
  Landmark,
  Laptop,
  Music,
  Palette,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tag,
  Train,
  TrendingUp,
  Utensils,
  Wallet,
  Wifi,
  Wine,
  Wrench,
  Zap,
} from 'lucide-react';

export const CATEGORY_ICONS = {
  'shopping-cart': ShoppingCart,
  utensils: Utensils,
  coffee: Coffee,
  wine: Wine,
  car: Car,
  fuel: Fuel,
  bus: Bus,
  train: Train,
  bike: Bike,
  plane: Plane,
  home: Home,
  zap: Zap,
  wifi: Wifi,
  smartphone: Smartphone,
  'heart-pulse': HeartPulse,
  dumbbell: Dumbbell,
  film: Film,
  music: Music,
  'gamepad-2': Gamepad2,
  'shopping-bag': ShoppingBag,
  shirt: Shirt,
  scissors: Scissors,
  gift: Gift,
  heart: Heart,
  baby: Baby,
  dog: Dog,
  'graduation-cap': GraduationCap,
  'book-open': BookOpen,
  repeat: Repeat,
  receipt: Receipt,
  landmark: Landmark,
  wrench: Wrench,
  palette: Palette,
  sparkles: Sparkles,
  briefcase: Briefcase,
  laptop: Laptop,
  'piggy-bank': PiggyBank,
  'hand-coins': HandCoins,
  'trending-up': TrendingUp,
  wallet: Wallet,
  tag: Tag,
  'circle-ellipsis': CircleEllipsis,
};

export function CategoryIcon({ icon, color = '#7f8882', size = 'md', className = '' }) {
  const Icon = CATEGORY_ICONS[icon] ?? Tag;
  const dims = { sm: 'h-7 w-7 rounded-lg', md: 'h-9 w-9 rounded-xl', lg: 'h-11 w-11 rounded-xl' }[size];
  const iconSize = { sm: 14, md: 17, lg: 20 }[size];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${dims} ${className}`}
      style={{ backgroundColor: `${color}1f`, color }}
      aria-hidden="true"
    >
      <Icon size={iconSize} strokeWidth={2.1} />
    </span>
  );
}

// Validated categorical palette (fixed order) followed by a few extra hues for larger sets.
export const CATEGORY_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
  '#0e8a9c',
  '#8a6d3b',
  '#b84fc2',
  '#6b7280',
];
