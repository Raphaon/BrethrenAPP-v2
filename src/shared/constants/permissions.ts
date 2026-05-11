export const PERMISSIONS = {
  // Users
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  USERS_DELETE: 'users:delete',
  USERS_MANAGE_ROLES: 'users:manage_roles',

  // Regions
  REGIONS_READ: 'regions:read',
  REGIONS_WRITE: 'regions:write',
  REGIONS_DELETE: 'regions:delete',

  // Districts
  DISTRICTS_READ: 'districts:read',
  DISTRICTS_WRITE: 'districts:write',
  DISTRICTS_DELETE: 'districts:delete',

  // Assemblies
  ASSEMBLIES_READ: 'assemblies:read',
  ASSEMBLIES_WRITE: 'assemblies:write',
  ASSEMBLIES_DELETE: 'assemblies:delete',

  // Preaching Points
  PREACHING_POINTS_READ: 'preaching_points:read',
  PREACHING_POINTS_WRITE: 'preaching_points:write',
  PREACHING_POINTS_DELETE: 'preaching_points:delete',

  // Members
  MEMBERS_READ: 'members:read',
  MEMBERS_WRITE: 'members:write',
  MEMBERS_DELETE: 'members:delete',

  // Pastors
  PASTORS_READ: 'pastors:read',
  PASTORS_WRITE: 'pastors:write',
  PASTORS_DELETE: 'pastors:delete',

  // Assignments
  ASSIGNMENTS_READ: 'assignments:read',
  ASSIGNMENTS_WRITE: 'assignments:write',
  ASSIGNMENTS_DELETE: 'assignments:delete',

  // Ministries
  MINISTRIES_READ: 'ministries:read',
  MINISTRIES_WRITE: 'ministries:write',
  MINISTRIES_DELETE: 'ministries:delete',

  // Announcements
  ANNOUNCEMENTS_READ: 'announcements:read',
  ANNOUNCEMENTS_WRITE: 'announcements:write',
  ANNOUNCEMENTS_PUBLISH: 'announcements:publish',
  ANNOUNCEMENTS_DELETE: 'announcements:delete',

  // News
  NEWS_READ: 'news:read',
  NEWS_WRITE: 'news:write',
  NEWS_PUBLISH: 'news:publish',
  NEWS_DELETE: 'news:delete',

  // Circulars
  CIRCULARS_READ: 'circulars:read',
  CIRCULARS_WRITE: 'circulars:write',
  CIRCULARS_PUBLISH: 'circulars:publish',
  CIRCULARS_DELETE: 'circulars:delete',

  // Events
  EVENTS_READ: 'events:read',
  EVENTS_WRITE: 'events:write',
  EVENTS_PUBLISH: 'events:publish',
  EVENTS_DELETE: 'events:delete',

  // Transfers
  TRANSFERS_READ: 'transfers:read',
  TRANSFERS_REQUEST: 'transfers:request',
  TRANSFERS_APPROVE: 'transfers:approve',
  TRANSFERS_REJECT: 'transfers:reject',

  // Notifications
  NOTIFICATIONS_READ: 'notifications:read',
  NOTIFICATIONS_WRITE: 'notifications:write',

  // Audit Logs
  AUDIT_LOGS_READ: 'audit_logs:read',
  ERROR_LOGS_READ: 'error_logs:read',
  USER_REPORTS_READ: 'user_reports:read',

  // Statistics
  STATISTICS_READ: 'statistics:read',

  // Roles & Permissions
  ROLES_READ: 'roles:read',
  ROLES_WRITE: 'roles:write',
  ROLES_DELETE: 'roles:delete',
  PERMISSIONS_READ: 'permissions:read',
  PERMISSIONS_WRITE: 'permissions:write',

  // Territory Accounts
  TERRITORY_ACCOUNTS_READ: 'territory_accounts:read',
  TERRITORY_ACCOUNTS_WRITE: 'territory_accounts:write',
  TERRITORY_ACCOUNTS_DELETE: 'territory_accounts:delete',

  // E-Shop
  SHOP_READ: 'shop:read',
  SHOP_WRITE: 'shop:write',
  SHOP_ORDERS_READ: 'shop:orders_read',
  SHOP_ORDERS_WRITE: 'shop:orders_write',

  // Newcomer Journey
  NEWCOMERS_READ: 'newcomers:read',
  NEWCOMERS_WRITE: 'newcomers:write',

  // Donations
  DONATIONS_READ: 'donations:read',
  DONATIONS_WRITE: 'donations:write',

  // Live & Médias
  LIVE_CHANNELS_CREATE:    'live_channels:create',
  LIVE_CHANNELS_READ:      'live_channels:read',
  LIVE_CHANNELS_UPDATE:    'live_channels:update',
  LIVE_CHANNELS_DELETE:    'live_channels:delete',
  LIVE_SERVICES_CREATE:    'live_services:create',
  LIVE_SERVICES_READ:      'live_services:read',
  LIVE_SERVICES_UPDATE:    'live_services:update',
  LIVE_SERVICES_PUBLISH:   'live_services:publish',
  LIVE_SERVICES_DELETE:    'live_services:delete',
  LIVE_HOSTS_MANAGE:       'live_hosts:manage',
  LIVE_CHAT_MODERATE:      'live_chat:moderate',
  LIVE_MOMENTS_MANAGE:     'live_moments:manage',
  LIVE_PRAYER_MANAGE:      'live_prayer:manage',
  LIVE_REPLAYS_MANAGE:     'live_replays:manage',
  LIVE_ANALYTICS_READ:     'live_analytics:read',
  LIVE_SETTINGS_MANAGE:    'live_settings:manage',

  // Portail public / QR Codes / Campagnes
  PUBLIC_CAMPAIGNS_CREATE:   'public_campaigns:create',
  PUBLIC_CAMPAIGNS_READ:     'public_campaigns:read',
  PUBLIC_CAMPAIGNS_UPDATE:   'public_campaigns:update',
  PUBLIC_CAMPAIGNS_ACTIVATE: 'public_campaigns:activate',
  PUBLIC_CAMPAIGNS_DELETE:   'public_campaigns:delete',
  PUBLIC_LINKS_CREATE:       'public_links:create',
  PUBLIC_LINKS_READ:         'public_links:read',
  PUBLIC_QR_CODES_GENERATE:  'public_qr_codes:generate',
  PUBLIC_SUBMISSIONS_READ:   'public_submissions:read',
  PUBLIC_SUBMISSIONS_EXPORT: 'public_submissions:export',
  PUBLIC_FORMS_MANAGE:       'public_forms:manage',
  PUBLIC_ANALYTICS_READ:     'public_analytics:read',
  PUBLIC_SETTINGS_MANAGE:    'public_settings:manage',

  // Consolidation / Suivi des âmes
  SOULS_READ:                         'souls:read',
  SOULS_WRITE:                        'souls:write',
  SOULS_ASSIGN:                       'souls:assign',
  SOULS_ARCHIVE:                      'souls:archive',
  FD_READ:                            'fd:read',
  FD_WRITE:                           'fd:write',
  FD_MANAGE:                          'fd:manage',
  DISCIPLE_MAKERS_MANAGE:             'disciple_makers:manage',
  FOLLOWUPS_READ:                     'followups:read',
  FOLLOWUPS_WRITE:                    'followups:write',
  SOUL_ATTENDANCE_MANAGE:             'soul_attendance:manage',
  CONSOLIDATION_JOURNEYS_MANAGE:      'consolidation_journeys:manage',
  TASK_FORCE_MANAGE:                  'task_force:manage',
  CONSOLIDATION_REPORTS_READ:         'consolidation_reports:read',
  CONSOLIDATION_SETTINGS_MANAGE:      'consolidation_settings:manage',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export type PermissionValue = (typeof PERMISSIONS)[PermissionKey];

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  TENANT_OWNER: 'tenant_owner',
  TENANT_ADMIN: 'tenant_admin',
  NATIONAL_ADMIN: 'national_admin',
  REGIONAL_LEADER: 'regional_leader',
  DISTRICT_LEADER: 'district_leader',
  ASSEMBLY_PASTOR: 'assembly_pastor',
  ASSEMBLY_ADMIN: 'assembly_admin',
  MINISTRY_LEADER: 'ministry_leader',
  MEMBER: 'member',
} as const;

export type RoleKey = keyof typeof ROLES;
export type RoleValue = (typeof ROLES)[RoleKey];
