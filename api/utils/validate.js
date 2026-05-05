const { ObjectId } = require("mongodb");

const ok = { valid: true };
const fail = (message) => ({ valid: false, message });

exports.validateObjectId = (id) => {
    try { new ObjectId(id); return ok; } catch { return fail("Invalid ID"); }
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;
const DEFAULT_PAGE = 1;

exports.parsePaginationParams = (query) => {
    const limit = Math.max(1, Math.min(parseInt(query.limit) || DEFAULT_LIMIT, MAX_LIMIT));
    const page = Math.max(1, parseInt(query.page) || DEFAULT_PAGE);
    return { limit, page };
};

const ALLOWED_STATUSES = ["read", "reading", "want to read"];
const ALLOWED_SORT_FIELDS = ["title", "author", "house"];
const MAX_DESCRIPTION_LEN = 1000;
const MAX_TITLE_LEN = 200;
const MAX_AUTHOR_LEN = 200;

exports.validateBookBody = ({ title, author, house, genre, description, language, locationInHouse, userStatus }) => {
    if (!title?.trim()) return fail("Title is required");
    if (!author?.trim()) return fail("Author is required");
    if (!house) return fail("House is required");
    if (!genre?.length) return fail("At least one genre is required");
    if (title.trim().length > MAX_TITLE_LEN) return fail(`Title must be ${MAX_TITLE_LEN} characters or fewer`);
    if (author.trim().length > MAX_AUTHOR_LEN) return fail(`Author must be ${MAX_AUTHOR_LEN} characters or fewer`);
    if (description && description.length > MAX_DESCRIPTION_LEN) return fail(`Description must be ${MAX_DESCRIPTION_LEN} characters or fewer`);
    if (language !== undefined && language !== null && language !== "" && typeof language !== "string") return fail("Invalid language value");
    if (locationInHouse !== undefined && locationInHouse !== null && locationInHouse !== "") {
        if (typeof locationInHouse !== "string") return fail("Invalid locationInHouse value");
        if (locationInHouse.length > 200) return fail("Location must be 200 characters or fewer");
    }
    if (userStatus !== undefined && userStatus !== null && !ALLOWED_STATUSES.includes(userStatus)) return fail("Invalid status value");
    return ok;
};

exports.validateStatusFilter = (status) => {
    if (status && status !== "no-status" && !ALLOWED_STATUSES.includes(status)) return fail("Invalid status filter");
    return ok;
};
exports.validateLanguageFilter = (language) => {
    if (language && typeof language !== "string") return fail("Invalid language filter");
    return ok;
};

exports.parseSortParams = (query) => {
    const sortBy = ALLOWED_SORT_FIELDS.includes(query.sortBy) ? query.sortBy : null;
    const sortOrder = query.sortOrder === "desc" ? -1 : 1;
    return { sortBy, sortOrder };
};

exports.parseSearchAfter = (raw) => {
    if (!raw) return { valid: true, value: undefined };
    try { return { valid: true, value: JSON.parse(raw) }; }
    catch { return { valid: false, message: "Invalid searchAfter value" }; }
};

exports.parseGenreFilter = (filterGenre) => {
    if (!filterGenre) return [];
    return Array.isArray(filterGenre) ? filterGenre : [filterGenre];
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const PASSWORD_UPPER = /[A-Z]/;
const PASSWORD_NUMBER = /\d/;
const PASSWORD_SPECIAL = /[!@#$%^&*(),.?":{}|<>]/;

exports.validateLoginBody = ({ email, password }) => {
    if (!email || !password) return fail("Email and password are required");
    if (!EMAIL_REGEX.test(email)) return fail("Invalid email format");
    return ok;
};

exports.validateOTPBody = ({ email, otp, newPassword }) => {
    if (!email || !otp || !newPassword) return fail("All fields are required");
    if (!EMAIL_REGEX.test(email)) return fail("Invalid email format");
    if (newPassword.length < MIN_PASSWORD_LEN) return fail(`Password must be at least ${MIN_PASSWORD_LEN} characters`);
    if (!PASSWORD_UPPER.test(newPassword)) return fail("Password must contain at least one uppercase letter");
    if (!PASSWORD_NUMBER.test(newPassword)) return fail("Password must contain at least one number");
    if (!PASSWORD_SPECIAL.test(newPassword)) return fail("Password must contain at least one special character");
    return ok;
};

exports.validateEmail = ({ email }) => {
    if (!email) return fail("Email is required");
    if (!EMAIL_REGEX.test(email)) return fail("Invalid email format");
    return ok;
};

const ALLOWED_THEMES = ["light", "dark"];
exports.validateTheme = ({ theme }) => {
    if (!ALLOWED_THEMES.includes(theme)) return fail("Invalid theme value");
    return ok;
};

exports.validateRating = (rating) => {
    if (rating === undefined || rating === null) return ok;
    const n = Number(rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) return fail("Rating must be a whole number between 1 and 5");
    return ok;
};

exports.validateReadingDates = ({ startedAt, finishedAt }) => {
    if (startedAt !== undefined && startedAt !== null) {
        const d = new Date(startedAt);
        if (isNaN(d.getTime())) return fail("Invalid started date");
        if (d > new Date()) return fail("Started date cannot be in the future");
    }
    if (finishedAt !== undefined && finishedAt !== null) {
        const d = new Date(finishedAt);
        if (isNaN(d.getTime())) return fail("Invalid finished date");
        if (d > new Date()) return fail("Finished date cannot be in the future");
    }
    if (startedAt && finishedAt && new Date(finishedAt) < new Date(startedAt))
        return fail("Finished date cannot be before started date");
    return ok;
};

const VALID_TRANSITIONS = {
    null: ["want to read", "reading", "read"],
    "want to read": ["reading", "read"],
    "reading": ["read"],
    "read": [],
};

exports.validateStatusTransition = (currentStatus, newStatus) => {
    if (!newStatus) return ok;
    if (currentStatus === newStatus) return ok;
    const allowed = VALID_TRANSITIONS[currentStatus ?? null] ?? [];
    if (!allowed.includes(newStatus))
        return fail(`Cannot change status from "${currentStatus || "none"}" to "${newStatus}"`);
    return ok;
};

const ALLOWED_ROLES = ["user", "admin"];
const MAX_NAME_LEN = 100;

exports.validateName = ({ name }) => {
    if (!name || !name.trim()) return fail("Name is required");
    if (name.trim().length > MAX_NAME_LEN) return fail(`Name must be ${MAX_NAME_LEN} characters or fewer`);
    return ok;
};

exports.validateNewPassword = ({ password }) => {
    if (!password) return fail("Password is required");
    if (password.length < MIN_PASSWORD_LEN) return fail(`Password must be at least ${MIN_PASSWORD_LEN} characters`);
    if (!PASSWORD_UPPER.test(password)) return fail("Password must contain at least one uppercase letter");
    if (!PASSWORD_NUMBER.test(password)) return fail("Password must contain at least one number");
    if (!PASSWORD_SPECIAL.test(password)) return fail("Password must contain at least one special character");
    return ok;
};

exports.validateRole = ({ role }) => {
    if (!ALLOWED_ROLES.includes(role)) return fail("Invalid role value");
    return ok;
};

const MAX_REFERENCE_NAME_LEN = 100;

exports.toTitleCase = (str) =>
    str.trim().toLowerCase().replace(/(?:^|-|\s)\S/g, (ch) => ch.toUpperCase());

exports.validateReferenceName = (name) => {
    if (!name || !name.trim()) return fail("Name is required");
    if (name.trim().length > MAX_REFERENCE_NAME_LEN) return fail(`Name must be ${MAX_REFERENCE_NAME_LEN} characters or fewer`);
    return ok;
};

const MAX_GENRES_PER_BOOK = 10;

exports.validateCSVRow = ({ title, author, house, genres, language, locationInHouse, description }) => {
    if (!title || !title.trim()) return fail("Title is required");
    if (!author || !author.trim()) return fail("Author is required");
    if (!house || !house.trim()) return fail("House is required");
    if (!genres || genres.length === 0) return fail("At least one genre is required");
    if (title.trim().length > MAX_TITLE_LEN) return fail(`Title must be ${MAX_TITLE_LEN} characters or fewer`);
    if (author.trim().length > MAX_AUTHOR_LEN) return fail(`Author must be ${MAX_AUTHOR_LEN} characters or fewer`);
    if (description && description.length > MAX_DESCRIPTION_LEN) return fail(`Description must be ${MAX_DESCRIPTION_LEN} characters or fewer`);
    if (locationInHouse && locationInHouse.length > 200) return fail("Location must be 200 characters or fewer");
    if (genres.length > MAX_GENRES_PER_BOOK) return fail(`A book can have at most ${MAX_GENRES_PER_BOOK} genres`);
    return ok;
};

// ─── Series ───────────────────────────────────────────────────────────────────

const MAX_SERIES_NAME_LEN = 200;
const MAX_SERIES_DESC_LEN = 1000;

exports.validateSeriesBody = ({ name, description }) => {
    if (!name || !name.trim()) return fail("Series name is required");
    if (name.trim().length > MAX_SERIES_NAME_LEN) return fail(`Series name must be ${MAX_SERIES_NAME_LEN} characters or fewer`);
    if (description && description.length > MAX_SERIES_DESC_LEN) return fail(`Description must be ${MAX_SERIES_DESC_LEN} characters or fewer`);
    return ok;
};

exports.validateSeriesOrder = (order) => {
    if (order === undefined || order === null || order === "") return ok;
    const n = Number(order);
    if (!Number.isInteger(n) || n < 1 || n > 9999) return fail("Series order must be a whole number between 1 and 9999");
    return ok;
};

// ─── Reading goal ─────────────────────────────────────────────────────────────

exports.validateReadingGoal = (target) => {
    const n = Number(target);
    if (!Number.isInteger(n) || n < 1 || n > 9999)
        return { valid: false, message: "Reading goal must be a whole number between 1 and 9999" };
    return { valid: true };
};

// ─── Wishlist ─────────────────────────────────────────────────────────────────

const MAX_WISHLIST_NOTE_LEN = 1000;

exports.validateWishlistItem = ({ title, author, note }) => {
    if (!title || !title.trim()) return { valid: false, message: "Title is required" };
    if (title.trim().length > 200) return { valid: false, message: "Title must be 200 characters or fewer" };
    if (!author || !author.trim()) return { valid: false, message: "Author is required" };
    if (author.trim().length > 200) return { valid: false, message: "Author must be 200 characters or fewer" };
    if (note && note.length > MAX_WISHLIST_NOTE_LEN)
        return { valid: false, message: `Note must be ${MAX_WISHLIST_NOTE_LEN} characters or fewer` };
    return { valid: true };
};