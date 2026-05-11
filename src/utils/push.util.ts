type PushEntityType =
  | 'Announcement'
  | 'Circular'
  | 'Event'
  | 'Conversation'
  | 'Donation'
  | 'PersonalEvent'
  | 'Notification';

export interface PushPreviewInput {
  title: string;
  body: string;
  entityType?: PushEntityType | string;
  entityId?: string;
  deepLink?: string;
  badge?: number;
  data?: Record<string, unknown>;
}

function resolveScreen(entityType?: string): string | null {
  switch (entityType) {
    case 'Announcement':
      return 'AnnouncementDetail';
    case 'Circular':
      return 'CircularDetail';
    case 'Event':
      return 'EventDetail';
    case 'Conversation':
      return 'Conversation';
    case 'Donation':
      return 'DonationDetail';
    case 'PersonalEvent':
      return 'PersonalEventDetail';
    case 'Notification':
      return 'Notifications';
    default:
      return null;
  }
}

export function buildDeepLink(entityType?: string, entityId?: string, explicitDeepLink?: string): string | null {
  if (explicitDeepLink) {
    return explicitDeepLink;
  }

  if (!entityType) {
    return null;
  }

  switch (entityType) {
    case 'Announcement':
      return entityId ? `brethren://announcements/${entityId}` : 'brethren://announcements';
    case 'Circular':
      return entityId ? `brethren://circulars/${entityId}` : 'brethren://circulars';
    case 'Event':
      return entityId ? `brethren://events/${entityId}` : 'brethren://events';
    case 'Conversation':
      return entityId ? `brethren://messages/${entityId}` : 'brethren://messages';
    case 'Donation':
      return entityId ? `brethren://donations/${entityId}` : 'brethren://donations';
    case 'PersonalEvent':
      return entityId ? `brethren://calendar/personal-events/${entityId}` : 'brethren://calendar';
    case 'Notification':
      return 'brethren://notifications';
    default:
      return null;
  }
}

export function buildPushPayload(input: PushPreviewInput) {
  const deepLink = buildDeepLink(input.entityType, input.entityId, input.deepLink);
  const screen = resolveScreen(input.entityType);

  return {
    title: input.title,
    body: input.body,
    sound: 'default',
    badge: input.badge ?? 1,
    data: {
      ...(input.data ?? {}),
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      deepLink,
      screen,
    },
  };
}
