const LICENSES = {
  None: { code: 1, desc: "No License" },
  Unlicense: { code: 2, desc: "The Unlicense" },
  MIT: { code: 3, desc: "MIT License" },
  GNU_GPLv2: { code: 4, desc: "GNU General Public License v2.0" },
  GNU_GPLv3: { code: 5, desc: "GNU General Public License v3.0" },
  GNU_LGPLv2_1: { code: 6, desc: "GNU Lesser General Public License v2.1" },
  GNU_LGPLv3: { code: 7, desc: "GNU Lesser General Public License v3.0" },
  BSD_2_Clause: { code: 8, desc: 'BSD 2-clause "Simplified" license' },
  BSD_3_Clause: { code: 9, desc: 'BSD 3-clause "New" Or "Revised" license*' },
  MPL_2_0: { code: 10, desc: "Mozilla Public License 2.0" },
  OSL_3_0: { code: 11, desc: "Open Software License 3.0" },
  Apache_2_0: { code: 12, desc: "Apache 2.0" },
  GNU_AGPLv3: { code: 13, desc: "GNU Affero General Public License" },
  BSL_1_1: { code: 14, desc: "Business Source License" },
};

export const CONST = {
  LICENSES,
  LICENSE_CODES: Object.values(LICENSES).map((license) => license.code),
};
