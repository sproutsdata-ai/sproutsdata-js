/**
 * Typed record shapes returned by the `/v1/entities/*` routes.
 *
 * Generated, not hand-written: each name here aliases a schema in
 * `openapi.gen.ts`, which `scripts/gen-types.mjs` renders from the vendored
 * `spec/openapi.json` (`dsp-backend`'s `app/schemas/records.py` and
 * `app/schemas/document_records.py`). A backend field addition is a spec
 * re-sync and a regeneration, never an edit here — `gen-types --check` fails
 * until the two agree, and a test fails if a schema the records reference has
 * no alias below.
 *
 * The server serializes every field of a record — a value it does not have is
 * an explicit `null` (or an empty list), never a missing key — so fields are
 * required, scalars are `T | null`, and lists are plain arrays.
 *
 * The nine top-level records stay open (`[field: string]: unknown`): the
 * server adds fields as its indexes grow, and a field this release does not
 * name is still readable, typed `unknown`, rather than a compile error.
 */

import type { components } from './openapi.gen';

type Schema<Name extends keyof components['schemas']> = components['schemas'][Name];

/** Fields the server adds after this release, readable without a cast. */
type OpenRecord = { [field: string]: unknown };

// --- GTM index: companies and people -----------------------------------------

/** One company from the GTM index (`/v1/entities/companies`). */
export type CompanyRecord = Schema<'CompanyRecord'> & OpenRecord;
/**
 * One person from the GTM index (`/v1/entities/persons`). Employer
 * firmographics are merged inline (`account_`-prefixed fields,
 * `company_linkedin_url`).
 */
export type PersonRecord = Schema<'PersonRecord'> & OpenRecord;
export type CertificationDetail = Schema<'CertificationDetail'>;
export type Deal = Schema<'Deal'>;
export type EducationEntry = Schema<'EducationEntry'>;
export type EmployeeRange = Schema<'EmployeeRange'>;
export type EmploymentEntry = Schema<'EmploymentEntry'>;
export type FundingRound = Schema<'FundingRound'>;
export type GlobalPresence = Schema<'GlobalPresence'>;
export type OfficeLocation = Schema<'OfficeLocation'>;
export type Organisation = Schema<'Organisation'>;
export type Product = Schema<'Product'>;
export type RevenueRange = Schema<'RevenueRange'>;

// --- Patents -----------------------------------------------------------------

/** One patent (`/v1/entities/patents`). */
export type PatentRecord = Schema<'PatentRecord'> & OpenRecord;
export type PatentApplicant = Schema<'PatentApplicant'>;
export type PatentApplication = Schema<'PatentApplication'>;
export type PatentClassificationDetail = Schema<'PatentClassificationDetail'>;
export type PatentCompanyConnection = Schema<'PatentCompanyConnection'>;
export type PatentCountry = Schema<'PatentCountry'>;
export type PatentInventor = Schema<'PatentInventor'>;
export type PatentPriorityFiling = Schema<'PatentPriorityFiling'>;
export type PatentPublication = Schema<'PatentPublication'>;

// --- News --------------------------------------------------------------------

/** One news article (`/v1/entities/news`). */
export type NewsRecord = Schema<'NewsRecord'> & OpenRecord;
export type NewsCompanyLinks = Schema<'NewsCompanyLinks'>;
export type NewsCompanyRef = Schema<'NewsCompanyRef'>;
export type NewsPlaces = Schema<'NewsPlaces'>;
export type NewsPublication = Schema<'NewsPublication'>;

// --- Trends ------------------------------------------------------------------

/** One trend (`/v1/entities/trends`). */
export type TrendRecord = Schema<'TrendRecord'> & OpenRecord;
export type TrendAgeMetric = Schema<'TrendAgeMetric'>;
export type TrendBadges = Schema<'TrendBadges'>;
export type TrendBand = Schema<'TrendBand'>;
export type TrendBoxplot = Schema<'TrendBoxplot'>;
export type TrendCategoryCount = Schema<'TrendCategoryCount'>;
export type TrendCompanyMaturity = Schema<'TrendCompanyMaturity'>;
export type TrendCompanyRef = Schema<'TrendCompanyRef'>;
export type TrendConnection = Schema<'TrendConnection'>;
export type TrendDeal = Schema<'TrendDeal'>;
export type TrendDescription = Schema<'TrendDescription'>;
export type TrendDistribution = Schema<'TrendDistribution'>;
export type TrendDistributions = Schema<'TrendDistributions'>;
export type TrendFeature = Schema<'TrendFeature'>;
export type TrendFeatures = Schema<'TrendFeatures'>;
export type TrendFunding = Schema<'TrendFunding'>;
export type TrendGraphPoint = Schema<'TrendGraphPoint'>;
export type TrendGraphs = Schema<'TrendGraphs'>;
export type TrendGrowth = Schema<'TrendGrowth'>;
export type TrendGrowthAnnualized = Schema<'TrendGrowthAnnualized'>;
export type TrendGrowthOverWindow = Schema<'TrendGrowthOverWindow'>;
export type TrendInvestedCompanies = Schema<'TrendInvestedCompanies'>;
export type TrendInvestor = Schema<'TrendInvestor'>;
export type TrendInvestorCompany = Schema<'TrendInvestorCompany'>;
export type TrendMarket = Schema<'TrendMarket'>;
export type TrendMarketCagr = Schema<'TrendMarketCagr'>;
export type TrendMarketSize = Schema<'TrendMarketSize'>;
export type TrendMetric = Schema<'TrendMetric'>;
export type TrendNamedTotal = Schema<'TrendNamedTotal'>;
export type TrendPatentStats = Schema<'TrendPatentStats'>;
export type TrendQuartile = Schema<'TrendQuartile'>;
export type TrendScale = Schema<'TrendScale'>;
export type TrendSearchInterest = Schema<'TrendSearchInterest'>;
export type TrendSignals = Schema<'TrendSignals'>;
export type TrendSimilarTag = Schema<'TrendSimilarTag'>;
export type TrendSnapshot = Schema<'TrendSnapshot'>;
export type TrendStartup = Schema<'TrendStartup'>;
export type TrendSummary = Schema<'TrendSummary'>;
export type TrendTotalAverage = Schema<'TrendTotalAverage'>;
export type TrendYoungestArticle = Schema<'TrendYoungestArticle'>;
export type TrendYoungestCompany = Schema<'TrendYoungestCompany'>;

// --- Market reports ----------------------------------------------------------

/** One market report (`/v1/entities/market-reports`). */
export type MarketReportRecord = Schema<'MarketReportRecord'> & OpenRecord;

// --- Funding rounds ----------------------------------------------------------

/** One funding round (`/v1/entities/fundings`). */
export type FundingRecord = Schema<'FundingRecord'> & OpenRecord;
export type FundingAmountNative = Schema<'FundingAmountNative'>;
export type FundingCompany = Schema<'FundingCompany'>;
export type FundingInvestor = Schema<'FundingInvestor'>;

// --- Academic reports --------------------------------------------------------

/** One academic report (`/v1/entities/academic-reports`). */
export type AcademicReportRecord = Schema<'AcademicReportRecord'> & OpenRecord;
export type AcademicAuthor = Schema<'AcademicAuthor'>;
export type AcademicCitation = Schema<'AcademicCitation'>;
export type AcademicCitationCounts = Schema<'AcademicCitationCounts'>;
export type AcademicReference = Schema<'AcademicReference'>;

// --- Job openings ------------------------------------------------------------

/** One job opening (`/v1/entities/job-openings`). */
export type JobOpeningRecord = Schema<'JobOpeningRecord'> & OpenRecord;
export type JobCompany = Schema<'JobCompany'>;
export type JobDepartment = Schema<'JobDepartment'>;
export type JobLocation = Schema<'JobLocation'>;
export type JobSalary = Schema<'JobSalary'>;
export type JobWorkArrangement = Schema<'JobWorkArrangement'>;
