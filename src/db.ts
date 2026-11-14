import Dexie,{type Table} from 'dexie';
import type {Profile,CV,JobAdvertisement} from './types';
class CareerDB extends Dexie {profiles!:Table<Profile,string>;cvs!:Table<CV,string>;jobs!:Table<JobAdvertisement,string>;constructor(){super('CareerMatchLocal');this.version(1).stores({profiles:'id',cvs:'id,updatedAt,jobTitle'});this.version(2).stores({profiles:'id',cvs:'id,updatedAt,jobTitle',jobs:'id,updatedAt,status'});}}
export const db=new CareerDB();
