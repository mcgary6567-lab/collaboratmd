/**
 * Reference pools for generating a realistic US medical practice.
 *
 * Names, places, specialties, payers and codes are all real-world shapes so
 * the seeded database exercises the same formats production data would.
 */

export const FIRST_NAMES_F = [
  "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen",
  "Lisa", "Nancy", "Betty", "Sandra", "Margaret", "Ashley", "Kimberly", "Emily", "Donna", "Michelle",
  "Carol", "Amanda", "Melissa", "Deborah", "Stephanie", "Rebecca", "Laura", "Sharon", "Cynthia", "Kathleen",
  "Amy", "Angela", "Shirley", "Anna", "Brenda", "Pamela", "Nicole", "Samantha", "Katherine", "Christine",
  "Maria", "Sofia", "Isabella", "Camila", "Valentina", "Aaliyah", "Imani", "Jasmine", "Mei", "Priya",
];

export const FIRST_NAMES_M = [
  "James", "Robert", "John", "Michael", "David", "William", "Richard", "Joseph", "Thomas", "Christopher",
  "Charles", "Daniel", "Matthew", "Anthony", "Mark", "Donald", "Steven", "Andrew", "Paul", "Joshua",
  "Kenneth", "Kevin", "Brian", "George", "Timothy", "Ronald", "Jason", "Edward", "Jeffrey", "Ryan",
  "Jacob", "Gary", "Nicholas", "Eric", "Jonathan", "Stephen", "Larry", "Justin", "Scott", "Brandon",
  "Carlos", "Luis", "Miguel", "Andre", "Marcus", "Omar", "Rahul", "Wei", "Diego", "Elias",
];

export const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
  "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
  "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
  "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts",
  "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker", "Cruz", "Edwards", "Collins", "Reyes",
  "Stewart", "Morris", "Morales", "Murphy", "Cook", "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper",
  "Peterson", "Bailey", "Reed", "Kelly", "Howard", "Ramos", "Kim", "Cox", "Ward", "Richardson",
  "Watson", "Brooks", "Chavez", "Wood", "James", "Bennett", "Gray", "Mendoza", "Ruiz", "Hughes",
  "Price", "Alvarez", "Castillo", "Sanders", "Patel", "Myers", "Long", "Ross", "Foster", "Jimenez",
];

/** [city, state, zip prefix, area code] */
export const US_CITIES: [string, string, string, string][] = [
  ["New York", "NY", "100", "212"], ["Brooklyn", "NY", "112", "718"], ["Buffalo", "NY", "142", "716"],
  ["Los Angeles", "CA", "900", "213"], ["San Diego", "CA", "921", "619"], ["San Jose", "CA", "951", "408"],
  ["Sacramento", "CA", "958", "916"], ["Chicago", "IL", "606", "312"], ["Aurora", "IL", "605", "630"],
  ["Houston", "TX", "770", "713"], ["Dallas", "TX", "752", "214"], ["Austin", "TX", "787", "512"],
  ["San Antonio", "TX", "782", "210"], ["Phoenix", "AZ", "850", "602"], ["Tucson", "AZ", "857", "520"],
  ["Philadelphia", "PA", "191", "215"], ["Pittsburgh", "PA", "152", "412"], ["Jacksonville", "FL", "322", "904"],
  ["Miami", "FL", "331", "305"], ["Tampa", "FL", "336", "813"], ["Orlando", "FL", "328", "407"],
  ["Columbus", "OH", "432", "614"], ["Cleveland", "OH", "441", "216"], ["Cincinnati", "OH", "452", "513"],
  ["Charlotte", "NC", "282", "704"], ["Raleigh", "NC", "276", "919"], ["Indianapolis", "IN", "462", "317"],
  ["Seattle", "WA", "981", "206"], ["Spokane", "WA", "992", "509"], ["Denver", "CO", "802", "303"],
  ["Boston", "MA", "021", "617"], ["Worcester", "MA", "016", "508"], ["Detroit", "MI", "482", "313"],
  ["Nashville", "TN", "372", "615"], ["Memphis", "TN", "381", "901"], ["Portland", "OR", "972", "503"],
  ["Las Vegas", "NV", "891", "702"], ["Milwaukee", "WI", "532", "414"], ["Albuquerque", "NM", "871", "505"],
  ["Kansas City", "MO", "641", "816"], ["St. Louis", "MO", "631", "314"], ["Atlanta", "GA", "303", "404"],
  ["Savannah", "GA", "314", "912"], ["Baltimore", "MD", "212", "410"], ["Louisville", "KY", "402", "502"],
  ["New Orleans", "LA", "701", "504"], ["Salt Lake City", "UT", "841", "801"], ["Boise", "ID", "837", "208"],
  ["Richmond", "VA", "232", "804"], ["Hartford", "CT", "061", "860"],
];

export const STREETS = [
  "Main St", "Oak Ave", "Maple Dr", "Cedar Ln", "Pine St", "Elm St", "Washington Ave", "Lake Dr",
  "Hillcrest Rd", "Park Blvd", "Sunset Dr", "Riverside Ave", "Church St", "Highland Ave", "Franklin St",
  "Meadow Ln", "Ridge Rd", "Willow Way", "Broadway", "Chestnut St",
];

/** [specialty, primary taxonomy code] */
export const SPECIALTIES: [string, string][] = [
  ["Family Medicine", "207Q00000X"],
  ["Internal Medicine", "207R00000X"],
  ["Pediatrics", "208000000X"],
  ["Cardiology", "207RC0000X"],
  ["Endocrinology", "207RE0101X"],
  ["Gastroenterology", "207RG0100X"],
  ["Nephrology", "207RN0300X"],
  ["Pulmonology", "207RP1001X"],
  ["Rheumatology", "207RR0500X"],
  ["Hematology & Oncology", "207RH0003X"],
  ["Infectious Disease", "207RI0200X"],
  ["Geriatric Medicine", "207QG0300X"],
  ["Obstetrics & Gynecology", "207V00000X"],
  ["Orthopaedic Surgery", "207X00000X"],
  ["General Surgery", "208600000X"],
  ["Dermatology", "207N00000X"],
  ["Neurology", "2084N0400X"],
  ["Psychiatry", "2084P0800X"],
  ["Physical Medicine & Rehab", "208100000X"],
  ["Otolaryngology", "207Y00000X"],
  ["Ophthalmology", "207W00000X"],
  ["Urology", "208800000X"],
  ["Allergy & Immunology", "207K00000X"],
  ["Emergency Medicine", "207P00000X"],
  ["Nurse Practitioner", "363L00000X"],
  ["Physician Assistant", "363A00000X"],
];

/** [payer name, clearinghouse payer id, type, timely filing days, appeal days, weight] */
export const US_PAYERS: [string, string, string, number, number, number][] = [
  ["UnitedHealthcare", "87726", "commercial", 90, 60, 16],
  ["Aetna", "60054", "commercial", 120, 60, 13],
  ["Cigna", "62308", "commercial", 90, 60, 10],
  ["Blue Cross Blue Shield of Texas", "84980", "commercial", 180, 90, 9],
  ["Anthem Blue Cross Blue Shield", "00060", "commercial", 180, 90, 9],
  ["Humana", "61101", "commercial", 180, 90, 7],
  ["Medicare Part B", "09102", "medicare", 365, 120, 16],
  ["Medicaid", "77027", "medicaid", 365, 90, 10],
  ["Tricare East", "99726", "commercial", 365, 90, 3],
  ["Kaiser Permanente", "94135", "commercial", 90, 60, 3],
  ["Oscar Health", "OSCAR", "commercial", 90, 60, 2],
  ["Molina Healthcare", "20554", "medicaid", 365, 90, 2],
];

/** [code, description, fee cents, relative frequency] */
export const CPTS: [string, string, number, number][] = [
  ["99213", "Office visit, established patient, low complexity", 13500, 22],
  ["99214", "Office visit, established patient, moderate complexity", 19500, 20],
  ["99212", "Office visit, established patient, straightforward", 8500, 8],
  ["99215", "Office visit, established patient, high complexity", 27500, 5],
  ["99203", "Office visit, new patient, low complexity", 16500, 7],
  ["99204", "Office visit, new patient, moderate complexity", 24500, 6],
  ["99202", "Office visit, new patient, straightforward", 11500, 3],
  ["99396", "Preventive visit, established patient 40-64", 19500, 5],
  ["99395", "Preventive visit, established patient 18-39", 18500, 4],
  ["G0439", "Annual wellness visit, subsequent", 17500, 4],
  ["36415", "Collection of venous blood by venipuncture", 1500, 18],
  ["80053", "Comprehensive metabolic panel", 4500, 10],
  ["85025", "Complete blood count with differential", 3200, 9],
  ["80061", "Lipid panel", 3800, 8],
  ["83036", "Hemoglobin A1c", 3900, 8],
  ["81002", "Urinalysis, non-automated, without microscopy", 900, 5],
  ["93000", "Electrocardiogram with interpretation", 6500, 6],
  ["90471", "Immunization administration, first vaccine", 3000, 5],
  ["90686", "Influenza vaccine, quadrivalent", 3500, 5],
  ["96372", "Therapeutic injection, subcutaneous or intramuscular", 4200, 4],
  ["20610", "Arthrocentesis, major joint", 15500, 3],
  ["69210", "Removal of impacted cerumen", 7500, 2],
  ["94640", "Inhalation treatment for airway obstruction", 5500, 2],
  ["17110", "Destruction of benign lesions, up to 14", 14500, 2],
  ["12001", "Simple repair of superficial wound, 2.5 cm or less", 21000, 2],
  ["97110", "Therapeutic exercises, each 15 minutes", 6500, 3],
  ["90834", "Psychotherapy, 45 minutes", 15000, 3],
  ["90837", "Psychotherapy, 60 minutes", 19500, 2],
  ["71046", "Chest X-ray, 2 views", 8200, 3],

  // Specialty procedures, imaging and infusions. Low frequency, high charge:
  // these are what lift a multi-specialty group's average claim value.
  ["45378", "Colonoscopy, diagnostic", 145000, 2.2],
  ["45380", "Colonoscopy with biopsy", 185000, 1.8],
  ["43239", "Upper GI endoscopy with biopsy", 135000, 1.6],
  ["93306", "Echocardiogram, complete with Doppler", 110000, 2.0],
  ["74177", "CT abdomen and pelvis with contrast", 160000, 1.5],
  ["70553", "MRI brain, with and without contrast", 240000, 1.0],
  ["64483", "Injection, lumbar epidural, single level", 190000, 1.2],
  ["66984", "Cataract removal with lens insertion", 320000, 0.8],
  ["29881", "Knee arthroscopy with meniscectomy", 420000, 0.7],
  ["49505", "Repair of initial inguinal hernia", 560000, 0.5],
  ["47562", "Laparoscopic cholecystectomy", 680000, 0.45],
  ["31255", "Endoscopic ethmoidectomy, total", 480000, 0.3],
  ["93458", "Cardiac catheterisation with angiography", 950000, 0.35],
  ["96413", "Chemotherapy infusion, first hour", 125000, 1.0],
  ["96415", "Chemotherapy infusion, each additional hour", 38000, 0.9],
  ["77427", "Radiation treatment management, 5 treatments", 180000, 0.6],
  ["19303", "Mastectomy, simple, complete", 1450000, 0.12],
  ["27447", "Total knee arthroplasty", 3200000, 0.15],
  ["27130", "Total hip arthroplasty", 3000000, 0.12],
];

/** [icd-10 code, description, relative frequency] */
export const ICDS: [string, string, number][] = [
  ["I10", "Essential (primary) hypertension", 20],
  ["E11.9", "Type 2 diabetes mellitus without complications", 16],
  ["E78.5", "Hyperlipidemia, unspecified", 14],
  ["Z00.00", "General adult medical exam without abnormal findings", 10],
  ["M54.50", "Low back pain, unspecified", 9],
  ["J06.9", "Acute upper respiratory infection, unspecified", 8],
  ["F41.1", "Generalized anxiety disorder", 7],
  ["K21.9", "Gastro-esophageal reflux disease without esophagitis", 6],
  ["E66.9", "Obesity, unspecified", 6],
  ["J45.20", "Mild intermittent asthma, uncomplicated", 5],
  ["F32.A", "Depression, unspecified", 5],
  ["M17.11", "Unilateral primary osteoarthritis, right knee", 4],
  ["N39.0", "Urinary tract infection, site not specified", 4],
  ["G47.00", "Insomnia, unspecified", 4],
  ["E03.9", "Hypothyroidism, unspecified", 4],
  ["R51.9", "Headache, unspecified", 3],
  ["Z23", "Encounter for immunization", 3],
  ["L30.9", "Dermatitis, unspecified", 3],
  ["J30.9", "Allergic rhinitis, unspecified", 3],
  ["M25.561", "Pain in right knee", 3],
  ["R07.9", "Chest pain, unspecified", 2],
  ["N18.3", "Chronic kidney disease, stage 3", 2],
  ["I48.91", "Unspecified atrial fibrillation", 2],
  ["D50.9", "Iron deficiency anemia, unspecified", 2],
  ["Z13.220", "Encounter for screening for lipoid disorders", 2],
  ["H61.23", "Impacted cerumen, bilateral", 1],
  ["S61.011A", "Laceration without foreign body of right thumb, initial", 1],
];

/** Denial mix: [CARC, RARC, share]. Roughly mirrors published payer denial data. */
export const DENIAL_MIX: [string, string | null, number][] = [
  ["16", "M51", 22],
  ["197", "N54", 16],
  ["27", "N30", 12],
  ["11", "M76", 10],
  ["18", "M86", 9],
  ["50", "M76", 8],
  ["96", "N130", 7],
  ["29", "N30", 6],
  ["4", null, 4],
  ["97", null, 3],
  ["109", null, 2],
  ["B7", null, 1],
];
