/**
 * Locale corpus. Names, schools, subjects and numbering that look like Ghana
 * rather than like a US demo database, because a fixture full of "John Smith,
 * Grade 5" hides real bugs: sorting on Akan day-names, two-part surnames,
 * +233 phone normalisation, and three-term year arithmetic all break on data
 * that never exercises them.
 *
 * All of this is invented. No row here corresponds to a real person.
 */

export const AKAN_DAY_NAMES_M = [
  'Kwasi', 'Kwadwo', 'Kwabena', 'Kwaku', 'Yaw', 'Kofi', 'Kwame',
] as const;

export const AKAN_DAY_NAMES_F = [
  'Akosua', 'Adwoa', 'Abenaa', 'Akua', 'Yaa', 'Afua', 'Amma',
] as const;

export const FIRST_NAMES_M = [
  ...AKAN_DAY_NAMES_M,
  'Kojo', 'Nana', 'Emmanuel', 'Samuel', 'Isaac', 'Enoch', 'Daniel', 'Michael',
  'Prince', 'Bright', 'Godfred', 'Ebenezer', 'Solomon', 'Elikem', 'Selorm',
  'Mawuli', 'Nii', 'Tetteh', 'Abdul-Rahman', 'Iddrisu', 'Yakubu', 'Musah',
];

export const FIRST_NAMES_F = [
  ...AKAN_DAY_NAMES_F,
  'Ama', 'Abena', 'Grace', 'Mercy', 'Comfort', 'Abigail', 'Priscilla',
  'Gifty', 'Vida', 'Esi', 'Araba', 'Efua', 'Naa', 'Dede', 'Korkor',
  'Elorm', 'Sena', 'Fatima', 'Zulaikha', 'Hawa', 'Rukaya',
];

export const MIDDLE_NAMES = [
  'Nana', 'Kojo', 'Adjoa', 'Yaw', 'Nii', 'Naa', 'Kwesi', 'Efua', 'Selasi', 'Kukua',
];

export const SURNAMES = [
  'Mensah', 'Owusu', 'Boateng', 'Asante', 'Agyeman', 'Appiah', 'Osei', 'Adjei',
  'Antwi', 'Amoah', 'Danso', 'Nyarko', 'Gyasi', 'Frimpong', 'Ofori', 'Sarpong',
  'Baidoo', 'Quaye', 'Tetteh', 'Lamptey', 'Ankrah', 'Nartey', 'Odoi', 'Aryee',
  'Acquah', 'Bentil', 'Arthur', 'Essien', 'Koomson', 'Aidoo', 'Otoo', 'Ansah',
  'Agbeko', 'Dzamesi', 'Amenyo', 'Attipoe', 'Sowah', 'Ayittey',
  'Abubakar', 'Alhassan', 'Fuseini', 'Mahama', 'Sulemana', 'Zakaria',
];

export const OCCUPATIONS = [
  'Trader', 'Teacher', 'Farmer', 'Seamstress', 'Driver', 'Nurse', 'Mason',
  'Hairdresser', 'Mechanic', 'Civil Servant', 'Shopkeeper', 'Carpenter',
  'Caterer', 'Electrician', 'Accountant', 'Security Officer', 'Tailor',
];

/** Real Ghanaian mobile prefixes, so phone-normalisation logic gets exercised. */
export const PHONE_PREFIXES = ['024', '054', '055', '059', '020', '050', '026', '056', '027', '057'];

export const DISTRICTS: { district: string; region: string }[] = [
  { district: 'Ga East Municipal', region: 'Greater Accra' },
  { district: 'Adentan Municipal', region: 'Greater Accra' },
  { district: 'Ledzokuku Municipal', region: 'Greater Accra' },
  { district: 'Tema Metropolitan', region: 'Greater Accra' },
  { district: 'Kumasi Metropolitan', region: 'Ashanti' },
  { district: 'Ejisu Municipal', region: 'Ashanti' },
  { district: 'New Juaben South', region: 'Eastern' },
  { district: 'Cape Coast Metropolitan', region: 'Central' },
  { district: 'Sekondi-Takoradi Metropolitan', region: 'Western' },
  { district: 'Tamale Metropolitan', region: 'Northern' },
  { district: 'Ho Municipal', region: 'Volta' },
];

export const SCHOOL_NAME_PARTS = {
  prefix: [
    'Sunrise', 'Bright Future', 'Faith', 'Christ the King', 'Golden Star',
    'Emmanuel', 'Mount Zion', 'Peace Islamic', 'Hope', 'Cornerstone',
    'Excellence', 'New Horizon', 'Divine Favour', 'Royal Oak',
  ],
  suffix: ['Basic School', 'Preparatory School', 'Academy', 'International School', 'Montessori'],
};

/** NaCCA Standards-Based Curriculum subject set for basic education. */
export const SUBJECTS: {
  name: string;
  code: string;
  core: boolean;
  divisions: ('Nursery' | 'Kindergarten' | 'Primary' | 'Junior High School')[];
  strands: number;
}[] = [
  { name: 'English Language', code: 'ENG', core: true, divisions: ['Kindergarten', 'Primary', 'Junior High School'], strands: 5 },
  { name: 'Mathematics', code: 'MAT', core: true, divisions: ['Kindergarten', 'Primary', 'Junior High School'], strands: 4 },
  { name: 'Integrated Science', code: 'SCI', core: true, divisions: ['Primary', 'Junior High School'], strands: 4 },
  { name: 'Social Studies', code: 'SOC', core: true, divisions: ['Junior High School'], strands: 3 },
  { name: 'Our World Our People', code: 'OWOP', core: false, divisions: ['Primary'], strands: 4 },
  { name: 'Ghanaian Language (Twi)', code: 'GHL', core: false, divisions: ['Primary', 'Junior High School'], strands: 5 },
  { name: 'French', code: 'FRE', core: false, divisions: ['Junior High School'], strands: 4 },
  { name: 'Religious and Moral Education', code: 'RME', core: false, divisions: ['Primary', 'Junior High School'], strands: 3 },
  { name: 'Creative Arts and Design', code: 'CAD', core: false, divisions: ['Primary', 'Junior High School'], strands: 3 },
  { name: 'Computing', code: 'ICT', core: false, divisions: ['Primary', 'Junior High School'], strands: 5 },
  { name: 'Career Technology', code: 'CTE', core: false, divisions: ['Junior High School'], strands: 4 },
  { name: 'Physical and Health Education', code: 'PHE', core: false, divisions: ['Primary', 'Junior High School'], strands: 3 },
  { name: 'Language and Literacy', code: 'LNL', core: false, divisions: ['Nursery', 'Kindergarten'], strands: 3 },
  { name: 'Numeracy', code: 'NUM', core: false, divisions: ['Nursery', 'Kindergarten'], strands: 3 },
];

/** The basic-education ladder, in order. sequence drives promotion. */
export const CLASS_LADDER: {
  division: 'Nursery' | 'Kindergarten' | 'Primary' | 'Junior High School';
  name: string;
  sequence: number;
  typicalAge: number;
}[] = [
  { division: 'Nursery', name: 'Nursery 1', sequence: 1, typicalAge: 3 },
  { division: 'Nursery', name: 'Nursery 2', sequence: 2, typicalAge: 4 },
  { division: 'Kindergarten', name: 'KG 1', sequence: 3, typicalAge: 5 },
  { division: 'Kindergarten', name: 'KG 2', sequence: 4, typicalAge: 6 },
  { division: 'Primary', name: 'Basic 1', sequence: 5, typicalAge: 7 },
  { division: 'Primary', name: 'Basic 2', sequence: 6, typicalAge: 8 },
  { division: 'Primary', name: 'Basic 3', sequence: 7, typicalAge: 9 },
  { division: 'Primary', name: 'Basic 4', sequence: 8, typicalAge: 10 },
  { division: 'Primary', name: 'Basic 5', sequence: 9, typicalAge: 11 },
  { division: 'Primary', name: 'Basic 6', sequence: 10, typicalAge: 12 },
  { division: 'Junior High School', name: 'JHS 1', sequence: 11, typicalAge: 13 },
  { division: 'Junior High School', name: 'JHS 2', sequence: 12, typicalAge: 14 },
  { division: 'Junior High School', name: 'JHS 3', sequence: 13, typicalAge: 15 },
];

export const MOMO_PROVIDERS = ['MTN MoMo', 'Telecel Cash', 'AirtelTigo Money'];

export const TEACHER_COMMENTS = [
  'A steady term. Reads with growing confidence.',
  'Capable, but must complete assignments on time.',
  'Excellent participation in group work.',
  'Needs more support with multiplication and division.',
  'Attendance has affected progress this term.',
  'Much improved since last term. Keep it up.',
  'Quiet in class but written work is strong.',
];

export const HEALTH_CONDITIONS = [
  'Asthma — inhaler kept in school office',
  'Sickle cell trait — noted by guardian',
  'Peanut allergy',
  'Recurrent malaria — guardian notified',
];

export const DISCIPLINE_SUMMARIES = [
  'Persistent lateness — three occurrences this term',
  'Damage to a classroom window during break',
  'Disruptive conduct during Integrated Science',
];
