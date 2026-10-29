import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { emptySelfProfile, selfProfileSchema } from "../src/contracts/v2/self-profile";
import type { EnvelopeCipher } from "../src/server/crypto";
import { createV2Core, snapshotStatements } from "../src/server/db/v2-core";
import {
  directoryProjectionStatements,
  selfDirectoryProjection,
} from "../src/server/db/v2-directory-projection";

export const SYNTHETIC_PROFILE_COUNT = 10;
export type Seed = {
  sql: string;
  profiles: { id: string; ownerId: string; name: string }[];
};
const quote = (v: unknown) =>
  v === null
    ? "NULL"
    : typeof v === "number" && Number.isFinite(v)
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`;
/** Only new, explicitly synthetic records are encrypted; no customer row is read. */
export async function prepareSyntheticLawyers(cipher: EnvelopeCipher, now: string): Promise<Seed> {
  const statements = new WeakMap<object, { sql: string; values: unknown[] }>();
  const prepare = (sql: string, values: unknown[] = []): D1PreparedStatement => {
    const statement = {
      bind: (...args: unknown[]) => prepare(sql, args),
    } as D1PreparedStatement;
    statements.set(statement, { sql, values });
    return statement;
  };
  const core = createV2Core({ prepare } as unknown as D1Database, cipher);
  const render = (statement: D1PreparedStatement) => {
    const value = statements.get(statement);
    if (!value) throw new Error("RESET_SEED_STATEMENT_INVALID");
    let i = 0;
    const sql = value.sql.replace(/\?/g, () => quote(value.values[i++]));
    if (i !== value.values.length) throw new Error("RESET_SEED_PARAMETERS_INVALID");
    return `${sql};`;
  };
  const suffix = crypto.randomUUID();
  const fixtures = [
    {
      city: "seoul",
      name: "김예시",
      introduction:
        "민사와 부동산 사건의 사실관계를 차근차근 정리합니다. API 시연용 합성 프로필입니다.",
      officeName: "예시 법률사무소",
      address: "서울특별시 서초구 서초대로 1",
      region: "seoul",
      practiceAreas: ["civil", "real_estate"],
      email: "seoul@example.invalid",
      website: "https://example.com",
    },
    {
      city: "busan",
      name: "박합성",
      introduction: "노동과 기업 분야를 다룹니다. API 시연용 합성 프로필입니다.",
      officeName: "합성 법률사무소",
      address: "부산광역시 연제구 법원로 1",
      region: "busan",
      practiceAreas: ["labor", "company"],
      email: "busan@example.invalid",
      website: "",
    },
  ];
  const extra = [
    ["daegu", "이합성", "대구광역시", "criminal"],
    ["incheon", "최예시", "인천광역시", "family"],
    ["gwangju", "정합성", "광주광역시", "administrative"],
    ["daejeon", "강예시", "대전광역시", "tax"],
    ["ulsan", "조합성", "울산광역시", "labor"],
    ["sejong", "윤예시", "세종특별자치시", "company"],
    ["gyeonggi", "장합성", "경기도", "intellectual_property"],
    ["gangwon", "임예시", "강원특별자치도", "real_estate"],
  ];
  for (const [city, name, regionName, field] of extra) {
    if (!city || !name || !regionName || !field) throw new Error("RESET_FIXTURE_INVALID");
    fixtures.push({
      city,
      name,
      introduction: `${regionName}의 사건 정리 화면을 확인하기 위한 API 시연용 합성 프로필입니다. 실제 변호사나 사무소 정보가 아닙니다.`,
      officeName: `${name} 합성 법률사무소`,
      address: `${regionName} 합성 주소 1`,
      region: city,
      practiceAreas: [field, "civil"],
      email: `${city}@example.invalid`,
      website: "",
    });
  }
  const sql: string[] = [];
  const profiles: Seed["profiles"] = [];
  for (const { city, ...fields } of fixtures) {
    const ownerId = `synthetic-owner-${city}-${suffix}`,
      id = `synthetic-lawyer-${city}-${suffix}`;
    const snapshotId = crypto.randomUUID(),
      claim = crypto.randomUUID();
    const profile = selfProfileSchema.parse({
      ...emptySelfProfile(id),
      ...fields,
      revision: 2,
      published: true,
      verificationStatus: "self_declared",
    });
    sql.push(
      render(
        core.statement(
          "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,0,?,?)",
          [ownerId, fields.name, `${ownerId}@example.invalid`, Date.parse(now), Date.parse(now)],
        ),
      ),
    );
    sql.push(
      render(
        core.statement("INSERT INTO user_consents VALUES(?,?,?,?,1,?)", [
          ownerId,
          CURRENT_POLICY_VERSIONS.termsVersion,
          CURRENT_POLICY_VERSIONS.privacyVersion,
          CURRENT_POLICY_VERSIONS.aiNoticeVersion,
          now,
        ]),
      ),
    );
    for (const [key, value] of [
      [`account-type:${ownerId}`, "lawyer"],
      [`synthetic-seed:${ownerId}`, "operator-authorized-synthetic-fixture"],
    ])
      sql.push(
        render(
          core.statement("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?)", [
            key,
            value,
            now,
          ]),
        ),
      );
    sql.push(
      render(
        core.statement(
          "INSERT INTO v2_profiles(id,owner_id,created_at,updated_at) VALUES(?,?,?,?)",
          [id, ownerId, now, now],
        ),
      ),
    );
    sql.push(
      render(
        core.statement(
          "INSERT INTO v2_mutation_claims(id,owner_id,target_id,revision) VALUES(?,?,?,2)",
          [claim, ownerId, id],
        ),
      ),
    );
    sql.push(
      ...(
        await snapshotStatements(
          core,
          {
            id: snapshotId,
            ownerId,
            workspaceId: null,
            purpose: "profile_revision",
            targetId: id,
            revision: 2,
            now,
          },
          profile,
          claim,
        )
      ).map(render),
    );
    const consent = await core.encrypt("v2_consents", snapshotId, ownerId, 2, {
      profileId: id,
      published: true,
      scope: "photo/introduction/practice/office/contact/portfolio",
      acceptedAt: now,
    });
    sql.push(
      render(
        core.statement(
          "INSERT INTO v2_consents(id,owner_id,kind,version,revision,encrypted_payload,created_at) VALUES(?,?,'profile_publication','mvp-self-profile-public-v1',2,?,?)",
          [snapshotId, ownerId, consent, now],
        ),
      ),
    );
    const projection = await selfDirectoryProjection(core, ownerId, snapshotId, profile, now);
    sql.push(
      ...directoryProjectionStatements(core, projection, claim).map(render),
      render(core.finish(claim)),
    );
    profiles.push({ id, ownerId, name: fields.name });
  }
  return { sql: sql.join("\n"), profiles };
}
