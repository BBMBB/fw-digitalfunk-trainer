export type TaskType = 'drawing'|'word'|'message'|'equipment';
export interface Feedback {correct:boolean;fields:boolean[]}
export interface TaskView {id:number;type:TaskType;partner:number;confirmed:boolean;content?:string|string[]|Record<string,string>;drawing?:string;answer?:unknown;feedback?:Feedback|null}
export interface Stats {completedRounds:number;correct:number;failedAttempts:number;duration:number}
export interface ProgressTask {id:number;sender:number;receiver:number;type:TaskType;content?:string|string[]|Record<string,string>;drawing?:string;senderConfirmed:boolean;receiverConfirmed:boolean}
export interface ReviewTask extends ProgressTask {content?:string|string[]|Record<string,string>;drawing?:string;answer?:unknown;feedback?:Feedback|null;correct?:boolean;failedAttempts?:number}
export interface State {
 _server?:string;_revision?:number;
 game:{id:string;name:string;status:'LOBBY'|'RUNNING'|'FINISHED';teamCount:number;roundCount:number;joined:number;startedAt:number|null;finishedAt:number|null}|null;
 team?:{number:number};round?:{id:number;number:number;finished:boolean;tasks?:ProgressTask[]}|null;
 send?:TaskView|null;receive?:TaskView|null;stats?:Stats;
 teams?:{number:number;joined:boolean;online:boolean;sendTo:number|null;receiveFrom:number|null}[];
 review?:{id:number;number:number;finished:boolean;skipped:boolean;legacy:boolean;tasks:ReviewTask[]}[];
 sessionInvalid?:boolean;adminExpired?:boolean;
}
export const taskTitles:Record<TaskType,string>={drawing:'Zeichnung diktieren',word:'Feuerwehrbegriff buchstabieren',message:'Lagemeldung übertragen',equipment:'Ausrüstungsliste übermitteln'};
