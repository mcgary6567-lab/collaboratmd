/** Sample HL7 messages for tests and the integration page's examples. */
import { buildSegment as seg } from "./v2";

export const ADT_A04 = [
  "MSH|^~\\&|EPIC|SUMMITCLINIC|COLLABORATMD|SUMMIT|20260924083000||ADT^A04^ADT_A01|MSG00001|P|2.5.1",
  seg("EVN", { 1: "A04", 2: "20260924083000" }),
  seg("PID", {
    1: "1", 3: "MRN44120^^^SUMMIT^MR~123-45-6789^^^SSA^SS", 5: "O'Brien^Siobhan^M", 7: "19850312", 8: "F",
    11: "12 Elm St^^Dallas^tx^75204", 13: "^PRN^PH^^^214^5550142~^NET^Internet^siobhan.obrien@Example.com",
  }),
  seg("PV1", { 1: "1", 2: "O", 3: "CLINIC^^^SUMMIT", 7: "1234567893^King^Jacob" }),
  seg("IN1", { 1: "1", 2: "PPO", 3: "60054", 4: "Aetna", 5: "PO Box 981106^^El Paso^TX^79998", 8: "GRP-7781", 17: "SEL", 36: "W123456789" }),
].join("\r");

export const DFT_P03 = [
  "MSH|^~\\&|EPIC|SUMMITCLINIC|COLLABORATMD|SUMMIT|20260924120000||DFT^P03|MSG00002|P|2.5.1",
  seg("EVN", { 1: "P03", 2: "20260924120000" }),
  seg("PID", { 1: "1", 3: "MRN44120^^^SUMMIT^MR", 5: "O'Brien^Siobhan", 7: "19850312", 8: "F" }),
  seg("PV1", { 1: "1", 2: "O", 3: "CLINIC", 7: "1234567893^King^Jacob", 19: "V99812" }),
  seg("FT1", {
    1: "1", 4: "20260923", 6: "CG", 7: "99214^Office visit est, moderate", 10: "1", 11: "185.00",
    19: "E11.9~I10", 20: "1234567893", 25: "99214^Office visit est, moderate^CPT4", 26: "25",
  }),
  seg("FT1", { 1: "2", 4: "20260923", 6: "CG", 7: "83036^Hemoglobin A1C", 10: "1", 19: "E11.9", 20: "1234567893", 25: "83036^Hemoglobin A1C^CPT4" }),
  seg("DG1", { 1: "1", 3: "E11.9^Type 2 diabetes mellitus without complications^I10", 15: "1" }),
  seg("DG1", { 1: "2", 3: "I10^Essential hypertension^I10", 15: "2" }),
].join("\r");
