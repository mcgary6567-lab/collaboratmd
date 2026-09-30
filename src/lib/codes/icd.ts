/**
 * The shape of an ICD-10-CM code, in one place. Three characters (a letter,
 * then letters or digits: E11, C4A, and from FY 2027 the QA chapter), then up
 * to four more after the dot. Whether a code exists and is billable on a date
 * is the loaded code set's job; this only checks the form. U codes (U07.1,
 * U09.9) are valid.
 */
export const ICD10CM_RE = /^[A-Z][0-9A-Z][0-9A-Z](\.?[0-9A-Z]{1,4})?$/i;

/** Without the dot, as CMS's files write it: E119, QA00101. */
export const ICD10CM_UNDOTTED_RE = /^[A-Z][0-9A-Z][0-9A-Z]{1,5}$/;
