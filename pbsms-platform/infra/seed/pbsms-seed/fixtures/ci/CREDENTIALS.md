# PBSMS fixture credentials

seed `pbsms-2026-baseline` · profile `ci` · as-of `2026-02-18` · hash `scrypt`

> **These passwords are published and the salts are derived, not random.**
> This file exists so a tester can log in without reading the generator.
> Never load this fixture into an environment that holds real people's data,
> and never let these hashes reach a production users table.

## Platform Console

| Email | Role | Password | MFA secret (base32) |
| --- | --- | --- | --- |
| `support1@pbsms.gh` | support | `Pbsms!Platform2026` | `3UYOWX6MQPR7E7CI3TZC` |
| `support2@pbsms.gh` | support | `Pbsms!Platform2026` | `TBJFOKLHJXPJ4AN2SZCZ` |
| `billing@pbsms.gh` | billing | `Pbsms!Platform2026` | `LC6HE2D4ZAMIYHIZSS7B` |
| `admin@pbsms.gh` | platform_admin | `Pbsms!Platform2026` | `WVPSROJI6QHDPVSOSERW` |

All platform users have MFA enabled — anyone who can impersonate into a
tenant should not be reachable with a password alone.

## Sunrise Basic School — `tnt_sunrise`

### Staff Console

| Email | Name | Roles | Password | Status | MFA |
| --- | --- | --- | --- | --- | --- |
| `shared.principal@example.gh` | Elikem Sulemana | proprietor | `Pbsms!Proprietor2026` | active ⚑ email_reused_across_tenants | `OY25SCJIFGYGXUKSVSCK` |
| `yakubu.boateng2@sunrise.edu.gh` | Yakubu Boateng | headmaster | `Pbsms!Head2026` | active | — |
| `rukaya.odoi3@sunrise.edu.gh` | Rukaya Odoi | accountant + headmaster | `Pbsms!Bursar2026` | active ⚑ conflict_of_interest | `5SLHI2ID5BGFVR3JD7AF` |
| `tetteh.osei4@sunrise.edu.gh` | Tetteh Osei | academic_coordinator | `Pbsms!Coord2026` | active | — |
| `nii.abubakar5@sunrise.edu.gh` | Nii Abubakar | admissions_officer | `Pbsms!Admissions2026` | active | — |
| `kwasi.appiah6@sunrise.edu.gh` | Kwasi Appiah | health_officer | `Pbsms!Health2026` | active | — |
| `elikem.ayittey7@sunrise.edu.gh` | Elikem Ayittey | teacher | `Pbsms!Teacher2026` | active | — |
| `iddrisu.owusu8@sunrise.edu.gh` | Iddrisu Owusu | teacher | `Pbsms!Teacher2026` | locked ⚑ locked_account | — |
| `kwaku.otoo9@sunrise.edu.gh` | Kwaku Otoo | teacher | `Pbsms!Teacher2026` | invited ⚑ never_activated | — |
| `akosua.zakaria10@sunrise.edu.gh` | Akosua Zakaria | teacher | `Pbsms!Teacher2026` | disabled ⚑ departed_staff | — |
| `zulaikha.aryee11@sunrise.edu.gh` | Zulaikha Aryee | teacher | `Pbsms!Teacher2026` | active | — |
| `solomon.adjei12@sunrise.edu.gh` | Solomon Adjei | teacher | `Pbsms!Teacher2026` | active | — |

**Teacher Field App:** `elikem.ayittey7@sunrise.edu.gh` / `Pbsms!Teacher2026` — scoped to JHS 2A.

### Parent View

Guardians authenticate by phone and OTP, not a password. Sample: `+233503669300`.

Most guardians reach the Parent View through a link instead. Three link states are seeded:

| Purpose | Token | Expires | Used |
| --- | --- | --- | --- |
| report_card | `fr8aZYbSYE5nGRXQULIs…` | 2026-03-03 | no |
| invoice | `_8OcnUDFjN5z2RmvdF49…` | 2026-01-23 | no |
| statement | `wtUzvXX4yvml2Vgn1LMW…` | 2026-02-23 | 2026-02-10 |

### Student · JHS only

Username is the admission number. Sample: Daniel Nartey (SBS/2025/0013) / `Pbsms!Student2026` — must change on first login.

### Accounts that should NOT simply work

| Account | Probe | Expected behaviour |
| --- | --- | --- |
| `shared.principal@example.gh` | email_reused_across_tenants | Same address exists in another tenant. Must resolve to exactly one account per tenant context. |
| `rukaya.odoi3@sunrise.edu.gh` | conflict_of_interest | Holds accountant and headmaster. Must be refused as their own four-eyes approver (FR-FIN-020). |
| `iddrisu.owusu8@sunrise.edu.gh` | locked_account | Correct password still refused while `locked_until` is in the future. |
| `kwaku.otoo9@sunrise.edu.gh` | never_activated | No hash exists. Must fail differently from a wrong password, and the invitation token must still work. |
| `akosua.zakaria10@sunrise.edu.gh` | departed_staff | Disabled. Login refused, but their marking history stays intact and attributed. |

## Bright Future Group — `tnt_brightfuture`

### Staff Console

| Email | Name | Roles | Password | Status | MFA |
| --- | --- | --- | --- | --- | --- |
| `shared.principal@example.gh` | Emmanuel Essien | proprietor | `Pbsms!Proprietor2026` | active ⚑ email_reused_across_tenants | `BZL7NGPHJXANDND6E7KQ` |
| `grace.sulemana2@brightfuture.edu.gh` | Grace Sulemana | headmaster | `Pbsms!Head2026` | active | — |
| `enoch.amenyo3@brightfuture.edu.gh` | Enoch Amenyo | accountant + headmaster | `Pbsms!Bursar2026` | active ⚑ conflict_of_interest | `TLUMP5WD5P7SVBDSUPR7` |
| `araba.sulemana4@brightfuture.edu.gh` | Araba Sulemana | academic_coordinator | `Pbsms!Coord2026` | active | — |
| `abena.koomson5@brightfuture.edu.gh` | Abena Koomson | admissions_officer | `Pbsms!Admissions2026` | active | — |
| `nii.ankrah6@brightfuture.edu.gh` | Nii Ankrah | health_officer | `Pbsms!Health2026` | active | — |
| `isaac.zakaria7@brightfuture.edu.gh` | Isaac Zakaria | teacher | `Pbsms!Teacher2026` | active | — |
| `selorm.agbeko8@brightfuture.edu.gh` | Selorm Agbeko | teacher | `Pbsms!Teacher2026` | locked ⚑ locked_account | — |
| `rukaya.aidoo9@brightfuture.edu.gh` | Rukaya Aidoo | teacher | `Pbsms!Teacher2026` | invited ⚑ never_activated | — |
| `amma.alhassan10@brightfuture.edu.gh` | Amma Alhassan | teacher | `Pbsms!Teacher2026` | disabled ⚑ departed_staff | — |
| `kojo.sowah11@brightfuture.edu.gh` | Kojo Sowah | teacher | `Pbsms!Teacher2026` | active | — |
| `akua.tetteh12@brightfuture.edu.gh` | Akua Tetteh | teacher | `Pbsms!Teacher2026` | active | — |
| `fatima.amenyo13@brightfuture.edu.gh` | Fatima Amenyo | teacher | `Pbsms!Teacher2026` | active | — |
| `elikem.gyasi14@brightfuture.edu.gh` | Elikem Gyasi | teacher | `Pbsms!Teacher2026` | active | — |
| `akua.abubakar15@brightfuture.edu.gh` | Akua Abubakar | teacher | `Pbsms!Teacher2026` | active | — |
| `enoch.owusu16@brightfuture.edu.gh` | Enoch Owusu | teacher | `Pbsms!Teacher2026` | active | — |
| `kojo.dzamesi46@brightfuture.edu.gh` | Kojo Dzamesi | proprietor | `Pbsms!Proprietor2026` | active | `FTVHRXQZ7FVAJR7ENCF2` |
| `ama.odoi47@brightfuture.edu.gh` | Ama Odoi | headmaster | `Pbsms!Head2026` | active | — |
| `abenaa.adjei48@brightfuture.edu.gh` | Abenaa Adjei | accountant + headmaster | `Pbsms!Bursar2026` | active ⚑ conflict_of_interest | `ZMLWQXZ4XUEZXU33WR3F` |
| `emmanuel.ofori49@brightfuture.edu.gh` | Emmanuel Ofori | academic_coordinator | `Pbsms!Coord2026` | active | — |
| `solomon.nyarko50@brightfuture.edu.gh` | Solomon Nyarko | admissions_officer | `Pbsms!Admissions2026` | active | — |
| `abena.amenyo51@brightfuture.edu.gh` | Abena Amenyo | health_officer | `Pbsms!Health2026` | active | — |
| `korkor.frimpong52@brightfuture.edu.gh` | Korkor Frimpong | teacher | `Pbsms!Teacher2026` | active | — |
| `priscilla.aryee53@brightfuture.edu.gh` | Priscilla Aryee | teacher | `Pbsms!Teacher2026` | locked ⚑ locked_account | — |
| `yaw.zakaria54@brightfuture.edu.gh` | Yaw Zakaria | teacher | `Pbsms!Teacher2026` | invited ⚑ never_activated | — |
| `mawuli.osei55@brightfuture.edu.gh` | Mawuli Osei | teacher | `Pbsms!Teacher2026` | disabled ⚑ departed_staff | — |
| `akua.bentil56@brightfuture.edu.gh` | Akua Bentil | teacher | `Pbsms!Teacher2026` | active | — |
| `daniel.nyarko57@brightfuture.edu.gh` | Daniel Nyarko | teacher | `Pbsms!Teacher2026` | active | — |

**Teacher Field App:** `isaac.zakaria7@brightfuture.edu.gh` / `Pbsms!Teacher2026` — scoped to JHS 2A.

### Parent View

Guardians authenticate by phone and OTP, not a password. Sample: `+233506130340`.

Most guardians reach the Parent View through a link instead. Three link states are seeded:

| Purpose | Token | Expires | Used |
| --- | --- | --- | --- |
| report_card | `-9d5ozh6Fx7xD4IoC-5e…` | 2026-03-03 | no |
| invoice | `o-3bRkjNe1gLdfgDkpta…` | 2026-01-23 | no |
| statement | `EaU-_---uTWgYGwJZgVV…` | 2026-02-23 | 2026-02-10 |

### Student · JHS only

Username is the admission number. Sample: Naa Asante (BFA/2022/0013) / `Pbsms!Student2026` — must change on first login.

### Accounts that should NOT simply work

| Account | Probe | Expected behaviour |
| --- | --- | --- |
| `shared.principal@example.gh` | email_reused_across_tenants | Same address exists in another tenant. Must resolve to exactly one account per tenant context. |
| `enoch.amenyo3@brightfuture.edu.gh` | conflict_of_interest | Holds accountant and headmaster. Must be refused as their own four-eyes approver (FR-FIN-020). |
| `selorm.agbeko8@brightfuture.edu.gh` | locked_account | Correct password still refused while `locked_until` is in the future. |
| `rukaya.aidoo9@brightfuture.edu.gh` | never_activated | No hash exists. Must fail differently from a wrong password, and the invitation token must still work. |
| `amma.alhassan10@brightfuture.edu.gh` | departed_staff | Disabled. Login refused, but their marking history stays intact and attributed. |
| `abenaa.adjei48@brightfuture.edu.gh` | conflict_of_interest | Holds accountant and headmaster. Must be refused as their own four-eyes approver (FR-FIN-020). |
| `priscilla.aryee53@brightfuture.edu.gh` | locked_account | Correct password still refused while `locked_until` is in the future. |
| `yaw.zakaria54@brightfuture.edu.gh` | never_activated | No hash exists. Must fail differently from a wrong password, and the invitation token must still work. |
| `mawuli.osei55@brightfuture.edu.gh` | departed_staff | Disabled. Login refused, but their marking history stays intact and attributed. |

## Mount Zion Preparatory — `tnt_mountzion` (**suspended**)

These credentials are valid. Login must still be refused on subscription
state, not on the credentials — that distinction is the point of this tenant.

### Staff Console

| Email | Name | Roles | Password | Status | MFA |
| --- | --- | --- | --- | --- | --- |
| `esi.bentil@mountzion.edu.gh` | Esi Bentil | proprietor | `Pbsms!Proprietor2026` | active | `TJTPA3OHUFUVGVEK7WY3` |
| `kwaku.dzamesi2@mountzion.edu.gh` | Kwaku Dzamesi | headmaster | `Pbsms!Head2026` | active | — |
| `naa.agyeman3@mountzion.edu.gh` | Naa Agyeman | accountant + headmaster | `Pbsms!Bursar2026` | active ⚑ conflict_of_interest | `JLW2JQPY6UMQ22ZQ77Y6` |
| `mercy.alhassan4@mountzion.edu.gh` | Mercy Alhassan | academic_coordinator | `Pbsms!Coord2026` | active | — |
| `samuel.arthur5@mountzion.edu.gh` | Samuel Arthur | admissions_officer | `Pbsms!Admissions2026` | active | — |
| `yakubu.bentil6@mountzion.edu.gh` | Yakubu Bentil | health_officer | `Pbsms!Health2026` | active | — |
| `nii.zakaria7@mountzion.edu.gh` | Nii Zakaria | teacher | `Pbsms!Teacher2026` | active | — |
| `kwasi.agbeko8@mountzion.edu.gh` | Kwasi Agbeko | teacher | `Pbsms!Teacher2026` | locked ⚑ locked_account | — |
| `emmanuel.koomson9@mountzion.edu.gh` | Emmanuel Koomson | teacher | `Pbsms!Teacher2026` | invited ⚑ never_activated | — |
| `abena.asante10@mountzion.edu.gh` | Abena Asante | teacher | `Pbsms!Teacher2026` | disabled ⚑ departed_staff | — |
| `godfred.gyasi11@mountzion.edu.gh` | Godfred Gyasi | teacher | `Pbsms!Teacher2026` | active | — |
| `mawuli.lamptey12@mountzion.edu.gh` | Mawuli Lamptey | teacher | `Pbsms!Teacher2026` | active | — |

**Teacher Field App:** `nii.zakaria7@mountzion.edu.gh` / `Pbsms!Teacher2026` — scoped to JHS 2A.

### Parent View

Guardians authenticate by phone and OTP, not a password. Sample: `+233556897140`.

Most guardians reach the Parent View through a link instead. Three link states are seeded:

| Purpose | Token | Expires | Used |
| --- | --- | --- | --- |
| report_card | `NH4hINgqBpyR-qirTR8N…` | 2026-03-03 | no |
| invoice | `eMZGymJhVby4qz1atj7T…` | 2026-01-23 | no |
| statement | `bMYQg8zcgjeAxIpuUqWW…` | 2026-02-23 | 2026-02-10 |

### Student · JHS only

Username is the admission number. Sample: Gifty Mensah (MZPS/2025/0007) / `Pbsms!Student2026` — must change on first login.

### Accounts that should NOT simply work

| Account | Probe | Expected behaviour |
| --- | --- | --- |
| `naa.agyeman3@mountzion.edu.gh` | conflict_of_interest | Holds accountant and headmaster. Must be refused as their own four-eyes approver (FR-FIN-020). |
| `kwasi.agbeko8@mountzion.edu.gh` | locked_account | Correct password still refused while `locked_until` is in the future. |
| `emmanuel.koomson9@mountzion.edu.gh` | never_activated | No hash exists. Must fail differently from a wrong password, and the invitation token must still work. |
| `abena.asante10@mountzion.edu.gh` | departed_staff | Disabled. Login refused, but their marking history stays intact and attributed. |

---

## Regenerating

```bash
pnpm seed -- --profile ci --hash scrypt   # fixture-grade scrypt hashes
pnpm seed -- --profile ci --hash none     # plain:<password>, rehash on load
```

Use `--hash none` if your auth service owns hashing. The generator writes
`plain:<password>` into `password_hash` and records `plaintext` in
`password_algo`, so a loader can hash with your own argon2id parameters and
a stray plaintext row is trivially greppable if one ever escapes.