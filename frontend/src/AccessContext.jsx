import {createContext,useContext} from 'react';
import {hasAccess} from '../../shared/access.mjs';
const AccessContext=createContext(null);
export function AccessProvider({user,children}) {return <AccessContext.Provider value={user}>{children}</AccessContext.Provider>;}
export function useAccess(){const user=useContext(AccessContext);return {user,can:permission=>hasAccess(user,permission)};}
