import type { ISODate, LifecycleState } from "../../types";

/** A status change as StatusRecordEditor hands it back, for ProjectDetail to write. */
export interface RecordDraft {
	date: ISODate;
	status: LifecycleState;
	note: string;
	why: string;
	/** Only for an active record; undefined is unset. */
	intensity?: number;
}
