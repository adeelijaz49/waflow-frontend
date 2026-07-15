import { Pipe, PipeTransform } from '@angular/core';

export type StatusDomain = 'order' | 'booking' | 'promotion';

// Status keys collide across domains with different meanings (e.g. 'confirmed'
// means "payment confirmed" for an order but "slot approved" for a booking) —
// so the map is keyed by domain rather than shared across all of them.
const BADGE_MAPS: Record<StatusDomain, Record<string, string>> = {
  order: {
    pending:   'badge-warning',
    confirmed: 'badge-info',
    shipped:   'badge-primary',
    delivered: 'badge-success',
    cancelled: 'badge-danger',
  },
  booking: {
    requested:    'badge-warning',
    confirmed:    'badge-success',
    cancelled:    'badge-danger',
    rescheduled:  'badge-warning',
    completed:    'badge-info',
    'no-show':    'badge-danger',
  },
  promotion: {
    draft:   'badge-neutral',
    active:  'badge-success',
    expired: 'badge-danger',
  },
};

@Pipe({ name: 'statusBadge', standalone: true })
export class StatusBadgePipe implements PipeTransform {
  transform(status: string, domain: StatusDomain): string {
    return BADGE_MAPS[domain]?.[status] ?? 'badge-neutral';
  }
}
