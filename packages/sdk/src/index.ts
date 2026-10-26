export { SproutsData, type SproutsDataCopyOptions, type SproutsDataOptions } from './client';
export type { Entities } from './entities';
export type { Relationships } from './relationships';
export type { OrgChart } from './org-chart';
export type { Credits } from './credits';
export type { History } from './history';
export type { Runs } from './runs';
export type { Feedback, FeedbackVotes } from './feedback';
export type { Lists } from './lists';
export type { Members } from './members';
export type { RequestOptions } from './http';
export type { PageOptions } from './paginate';
export {
  SproutsDataError,
  ClientValidationError,
  APIConnectionError,
  APITimeoutError,
  APIUserAbortError,
  APIResponseValidationError,
  RunWaitTimeoutError,
  APIError,
  InvalidRequestError,
  CursorInvalidError,
  CursorExpiredError,
  PaginationDepthExceededError,
  AuthenticationError,
  InsufficientCreditsError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  IdempotencyConflictError,
  RequestTooLargeError,
  RateLimitError,
  InternalServerError,
  FeatureNotAvailableError,
  ServiceUnavailableError,
  UpstreamTimeoutError,
  type FieldError,
} from './errors';
export { ErrorCode } from './types';
export { DEFAULT_BASE_URL } from './constants';
// A search hit's id is not a lookup key; this turns a hit into one.
export { lookupRef, type LookupRef } from './lookup';
export type {
  SearchMode,
  EntityCategory,
  DocumentCategory,
  SproutsDataEnvironment,
  SimilarAnchorBy,
  SimilarCombine,
  UsageGranularity,
  SortDirection,
  DiscoverSortField,
  KeywordQuery,
  SortClause,
  SearchParams,
  DiscoverSearchParams,
  DocumentSearchParams,
  SimilarAnchor,
  SimilarParams,
  EntitiesResolveBy,
  CompanyEntitiesParams,
  PersonEntitiesParams,
  DocumentEntitiesParams,
  NamedDocumentLookupBy,
  NamedDocumentEntitiesParams,
  EntityHit,
  EntitiesEnvelope,
  UsageParams,
  ResponseMeta,
  Attribution,
  Degradation,
  Coverage,
  ResolvedSearch,
  SearchSuggestion,
  EnvelopeColumn,
  ColumnSource,
  SearchHit,
  Envelope,
  SearchEnvelope,
  UsageBucket,
  UsageResponse,
  AllocatedCredits,
  SharedCredits,
  CreditsResponse,
  CoverageParams,
  CoverageSegment,
  CoverageResponse,
  FilterValuesLevel,
  FilterValuesParams,
  FilterValueItem,
  FilterValuesResponse,
  DocumentFilterValuesParams,
  DocumentFilterValuesResponse,
  SortFieldInfo,
  SortCatalogResponse,
  Problem,
} from './types';
// The discover filter vocabulary for `search`/`similar` `filters`
// (DiscoverFilters, TermsFilter, RangeFilter, GeoFilter, …) and the
// FilterName union for `filterValues`.
export type * from './filters';
// The `/v1/relationships` request/response shapes (RelationshipParams,
// RelationshipEnvelope, ReachHit, …).
export type {
  RelationKind,
  ConnectionBasis,
  InstitutionType,
  PeopleConstraints,
  RelationshipCompanyRef,
  RelationshipInstitutionRef,
  RelationshipParams,
  RelationshipReachParams,
  ViaInstitution,
  RelationshipHit,
  SharedInstitution,
  RelationshipEnvelope,
  Connection,
  ReachHit,
  ReachInstitution,
  ReachEnvelope,
  Breakdown,
  BreakdownGroup,
  Share,
  SeedReach,
  ReachTarget,
  RelationshipInstitutionsParams,
  SharedInstitutionsEnvelope,
  RelationshipAskParams,
  AskRoute,
  AskReading,
  ComparisonSideEnvelope,
  ComparisonEnvelope,
  DrillDownEnvelope,
  FanOutEnvelope,
  AskEnvelope,
} from './relationships';
// The `/v1/org-chart*` shapes. UNKNOWN_CODE is a value export: it is the code
// of the explicit Unknown row, column and place.
export { UNKNOWN_CODE } from './org-chart';
export type {
  OrgChartGovernanceLevel,
  OrgChartEmploymentType,
  OrgChartMetric,
  OrgChartPlaceLevel,
  OrgChartPlace,
  OrgChartIdentifier,
  OrgChartFilters,
  OrgChartParams,
  OrgChartDepartmentsParams,
  OrgChartLocationsParams,
  OrgChartCompany,
  OrgChartCode,
  OrgChartStatus,
  OrgChartMatched,
  OrgChartAxisEntry,
  OrgChartBadges,
  OrgChartCell,
  OrgChartSubdepartment,
  OrgChartCoverage,
  OrgChartResponse,
  OrgChartDepartmentsResponse,
  OrgChartLocation,
  OrgChartLocationsResponse,
} from './org-chart';
// The `/v1/usage/history*` shapes. failureRate is a value export: the
// success share of a metrics response or bucket, pending runs left out.
export { failureRate } from './history';
export type {
  HistoryActionType,
  HistoryRunStatus,
  SnapshotState,
  HistoryListParams,
  HistoryRunSummary,
  HistoryRunDetail,
  HistoryMetricsParams,
  HistoryMetricsBucket,
  HistoryMetricsResponse,
} from './history';
// The `/v1/agents/runs*` shapes. TERMINAL_RUN_EVENTS is a value export so
// stream consumers can branch on terminal frames.
export { TERMINAL_RUN_EVENTS } from './runs';
export type {
  AgentRunCategory,
  AgentEffort,
  AgentRunStatus,
  AgentRunParams,
  CreateRunOptions,
  WaitRunOptions,
  AgentRunHandle,
  AgentRunResult,
  AgentRunListItem,
  AgentRunList,
  AgentRunRow,
  AgentRunResultsEnvelope,
  AgentRunEventType,
  AgentRunEvent,
} from './runs';
// The `/v1/feedback*` shapes.
export type {
  FeedbackSubjectKind,
  FeedbackSubjectRef,
  FeedbackTargetKind,
  FeedbackTarget,
  FeedbackSentiment,
  FeedbackTag,
  FeedbackExpected,
  FeedbackCreateParams,
  FeedbackCreated,
  FeedbackStatus,
  FeedbackListParams,
  FeedbackSubject,
  FeedbackView,
  FeedbackListResponse,
  TagDescriptor,
  TagVocabularyResponse,
  VoteLevel,
  VoteValue,
  VoteCastParams,
  VoteView,
  VoteCastResponse,
  VoteListResponse,
} from './feedback';
export type {
  ItemRef,
  FieldTier,
  SavedList,
  ListsResponse,
  SavedItem,
  ListItemsResponse,
  ListItemsParams,
  AddItemsResponse,
  RemoveItemsResponse,
  SearchExportParams,
  CsvExport,
} from './lists';
// The `/v1/members/resolve` shapes.
export type { MemberState, MemberResolveResponse } from './members';
// The SSE primitives behind `runs.events`, exported for testing consumer
// code against fabricated streams.
export { parseSseStream, type ParseSseOptions, type SseMessage } from './sse';
// The typed record shapes behind each `/v1/entities/*` category
// (CompanyRecord, PersonRecord, PatentRecord, …) and their nested pieces.
export type * from './records';
export { VERSION } from './version';

export { SproutsData as default } from './client';
