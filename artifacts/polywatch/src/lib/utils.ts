import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function truncateAddress(address: string, chars = 4): string {
  if (!address || address.length < chars * 2 + 2) return address;
  return `${address.substring(0, chars + 2)}...${address.substring(address.length - chars)}`;
}

export function formatTimeAgo(timestampSeconds: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestampSeconds);
  
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + "y ago";
  
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + "mo ago";
  
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + "d ago";
  
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + "h ago";
  
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + "m ago";
  
  return Math.floor(seconds) + "s ago";
}

export function getRiskColorClass(score: number): string {
  if (score >= 80) return "text-destructive border-destructive bg-destructive/10";
  if (score >= 50) return "text-orange-500 border-orange-500/50 bg-orange-500/10";
  if (score >= 25) return "text-yellow-500 border-yellow-500/50 bg-yellow-500/10";
  return "text-green-500 border-green-500/50 bg-green-500/10";
}

export function getAgeColorClass(days: number): string {
  if (days < 7) return "text-destructive border-destructive bg-destructive/10";
  if (days <= 30) return "text-orange-500 border-orange-500/50 bg-orange-500/10";
  return "text-muted-foreground border-border bg-muted/30";
}
